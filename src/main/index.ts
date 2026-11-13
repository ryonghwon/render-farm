import { resolveDataDir } from './data-directory'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, net, powerSaveBlocker, protocol, shell } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Engine } from './engine/engine'
import { findFfmpeg, thumbnail } from './engine/ffmpeg'
import type { AppInfo, AppSettings, CompletionAction, JobPatch, PreviewInfo, RenderSettings } from '../shared/types'

const E2E_SCRIPT = !app.isPackaged ? process.env.RENDERFARM_E2E_SCRIPT : undefined
app.setPath('userData', resolveDataDir(app.getPath('appData'), process.env.RENDERFARM_DATA_DIR))

protocol.registerSchemesAsPrivileged([
  { scheme: 'rdfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } }
])

let win: BrowserWindow | null = null
let engine: Engine
let blockerId: number | null = null
let quitting = false
let pushTimer: NodeJS.Timeout | null = null
let lastPush = 0

const primaryInstance = !!E2E_SCRIPT || app.requestSingleInstanceLock()
if (!primaryInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

function pushState(): void {
  if (!win || win.isDestroyed()) return
  const now = Date.now()
  const wait = Math.max(0, 120 - (now - lastPush))
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    lastPush = Date.now()
    if (win && !win.isDestroyed()) win.webContents.send('state', engine.snapshot())
  }, wait)
}

function setAwake(on: boolean): void {
  if (on && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension')
  if (!on && blockerId !== null) {
    powerSaveBlocker.stop(blockerId)
    blockerId = null
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1120,
    minHeight: 680,
    show: false,
    backgroundColor: '#FFFFFF',
    title: 'Render Farm',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => {
    if (!process.env.RENDERFARM_HIDDEN) win?.show()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.on('close', async (e) => {
    if (quitting || !engine.hasRunningWork() || E2E_SCRIPT) return
    e.preventDefault()
    const r = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Stop rendering and quit', 'Keep rendering'],
      defaultId: 1,
      cancelId: 1,
      title: 'Render Farm',
      message: 'Rendering is in progress.',
      detail: 'Quitting stops active render processes. You can resume the remaining frames the next time you open the app.'
    })
    if (r.response === 0) {
      quitting = true
      app.quit()
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function migrateLegacyData(dir: string): void {
  if (process.env.RENDERFARM_DATA_DIR) return
  const source = path.join(app.getPath('appData'), 'RenderDock', 'state.json')
  const target = path.join(dir, 'state.json')
  if (fs.existsSync(target) || !fs.existsSync(source)) return
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(source, target)
  } catch {
    return
  }
}

function notify(title: string, body: string): void {
  if (!engine.app.notifications || !Notification.isSupported()) return
  new Notification({ title, body, silent: false }).show()
}

async function previewFor(jobId: string): Promise<PreviewInfo> {
  const job = engine.jobs.find((j) => j.id === jobId)
  const video = job?.previewVideo && fs.existsSync(job.previewVideo) ? `rdfile://local/${encodeURIComponent(job.previewVideo)}` : null
  const lf = engine.latestFrame(jobId)
  if (!lf) return { frame: null, path: null, dataUrl: null, video, message: 'No rendered frames' }
  const ext = path.extname(lf.path).toLowerCase()
  try {
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      const img = nativeImage.createFromPath(lf.path)
      if (!img.isEmpty()) {
        const size = img.getSize()
        const out = size.width > 960 ? img.resize({ width: 960, quality: 'good' }) : img
        return { frame: lf.frame, path: lf.path, dataUrl: out.toDataURL(), video, message: null }
      }
    }
    const ffmpeg = findFfmpeg(engine.app.ffmpegPath)
    if (!ffmpeg)
      return {
        frame: lf.frame,
        path: lf.path,
        dataUrl: null,
        video,
        message: `FFmpeg is required to preview ${ext.slice(1).toUpperCase()} files`
      }
    const cacheDir = path.join(app.getPath('temp'), 'renderfarm-thumbs')
    fs.mkdirSync(cacheDir, { recursive: true })
    const st = fs.statSync(lf.path)
    const out = path.join(cacheDir, `${Buffer.from(lf.path).toString('base64url').slice(-48)}_${Math.round(st.mtimeMs)}.jpg`)
    if (!fs.existsSync(out)) await thumbnail(ffmpeg, lf.path, out, 960)
    const img = nativeImage.createFromPath(out)
    return {
      frame: lf.frame,
      path: lf.path,
      dataUrl: img.isEmpty() ? null : img.toDataURL(),
      video,
      message: img.isEmpty() ? 'Could not generate preview' : null
    }
  } catch (e) {
    return { frame: lf.frame, path: lf.path, dataUrl: null, video, message: `Could not generate preview: ${(e as Error).message}` }
  }
}

function registerIpc(): void {
  const h = (ch: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(ch, (event, ...args) => {
      if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Unknown IPC sender')
      return fn(...args)
    })
  h('state:get', () => engine.snapshot())
  h('log:get', (jobId: string | null) => engine.getLog(jobId))
  h('jobs:add', (paths: string[]) => engine.addPaths(paths))
  h('jobs:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Add scene files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Scene files', extensions: ['ma', 'mb', 'blend'] },
        { name: 'Maya scenes', extensions: ['ma', 'mb'] },
        { name: 'Blender files', extensions: ['blend'] }
      ]
    })
    return r.canceled ? { added: 0, skipped: 0 } : engine.addPaths(r.filePaths)
  })
  h('jobs:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Add folder', properties: ['openDirectory', 'multiSelections'] })
    return r.canceled ? { added: 0, skipped: 0 } : engine.addPaths(r.filePaths)
  })
  h('jobs:remove', (ids: string[]) => engine.removeJobs(ids))
  h('jobs:reorder', (ids: string[]) => engine.reorderJobs(ids))
  h('jobs:move', (ids: string[], where: 'top' | 'bottom') => engine.moveJobs(ids, where))
  h('jobs:duplicate', (ids: string[]) => engine.duplicateJobs(ids))
  h('jobs:update', (ids: string[], patch: JobPatch) => engine.updateJobs(ids, patch))
  h('jobs:reset', (ids: string[], mode: 'full' | 'missing') => engine.resetJobs(ids, mode))
  h('jobs:reprobe', (ids: string[], deep: boolean) => engine.reprobe(ids, deep))
  h('jobs:clearFinished', () => engine.clearFinished())
  h('jobs:skip', (ids: string[]) => engine.skip(ids))
  h('global:update', (patch: Partial<RenderSettings>) => engine.updateGlobal(patch))
  h('app:update', (patch: Partial<AppSettings>) => engine.updateApp(patch))
  h('render:start', () => engine.start())
  h('render:pause', () => engine.pause())
  h('render:resume', () => engine.resume())
  h('render:stop', () => engine.stop())
  h('completion:set', (a: CompletionAction) => engine.setCompletion(a))
  h('completion:cancel', () => engine.cancelCountdown())
  h('completion:now', () => engine.executeCompletion())
  h('preset:save', (name: string) => engine.savePreset(name))
  h('preset:apply', (id: string) => engine.applyPreset(id))
  h('preset:delete', (id: string) => engine.deletePreset(id))
  h('lock:unlock', (pin: string) => engine.unlock(pin))
  h('lock:now', () => engine.lockNow())
  h('lock:setPin', (pin: string | null) => engine.setPin(pin))
  h('apps:detect', () => engine.detectApps())
  h('apps:add', async (app: 'maya' | 'blender') => {
    const r = await dialog.showOpenDialog(win!, {
      title:
        process.platform === 'darwin'
          ? app === 'blender'
            ? 'Choose Blender application'
            : 'Choose Maya application'
          : app === 'blender'
            ? 'Choose blender.exe'
            : 'Choose Render.exe',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: app === 'blender' ? 'blender.exe' : 'Render.exe', extensions: ['exe'] }] : []
    })
    if (!r.canceled && r.filePaths[0]) engine.addInstall(r.filePaths[0])
  })
  h('apps:remove', (id: string) => engine.removeInstall(id))
  h('dialog:outputDir', async (current?: string) => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose output folder',
      defaultPath: current || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  h('dialog:ffmpeg', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose FFmpeg', properties: ['openFile'] })
    return r.canceled ? null : r.filePaths[0]
  })
  h('shell:open', async (p: string) => {
    if (!p) return
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
    await shell.openPath(p)
  })
  h('shell:show', (p: string) => p && shell.showItemInFolder(p))
  h('preview:get', (jobId: string) => previewFor(jobId))
  h(
    'app:info',
    (): AppInfo => ({
      version: app.getVersion(),
      platform: process.platform,
      dataDir: app.getPath('userData'),
      cores: os.cpus().length,
      electron: process.versions.electron
    })
  )
  h('logs:dir', (jobId: string | null) => {
    const dir = jobId ? path.join(app.getPath('userData'), 'logs', jobId) : path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
}

if (primaryInstance)
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('kr.ac.kaywon.renderfarm')
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)
    protocol.handle('rdfile', (req) => {
      const url = new URL(req.url)
      const p = decodeURIComponent(url.pathname.replace(/^\//, ''))
      return net.fetch(pathToFileURL(p).toString())
    })
    migrateLegacyData(app.getPath('userData'))
    engine = new Engine({ dataDir: app.getPath('userData'), dryRunPower: process.env.RENDERFARM_DRY_POWER === '1' })
    engine.on('change', pushState)
    engine.on('log', (lines) => win && !win.isDestroyed() && win.webContents.send('log', lines))
    engine.on('notify', (n: { title: string; body: string }) => notify(n.title, n.body))
    engine.on('awake', (on: boolean) => setAwake(on))
    engine.on('progress', (p: number) => win && !win.isDestroyed() && win.setProgressBar(p, { mode: p < 0 ? 'none' : 'normal' }))
    engine.on('countdown', () => {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.flashFrame(true)
      }
    })
    engine.on('quit', () => {
      quitting = true
      app.quit()
    })
    await engine.init()
    registerIpc()
    createWindow()
    if (E2E_SCRIPT && win) {
      const mod = await import(pathToFileURL(E2E_SCRIPT).href)
      const run = (mod.default ?? mod) as (ctx: unknown) => Promise<void>
      await run({ engine, win, app, path, fs })
    }
  })

let shutdownComplete = false
let shutdownStarted = false
app.on('before-quit', (event) => {
  if (!engine || shutdownComplete) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  quitting = true
  if (pushTimer) clearTimeout(pushTimer)
  void engine
    .shutdown()
    .then(() => {
      setAwake(false)
      shutdownComplete = true
      app.quit()
    })
    .catch((error: Error) => {
      shutdownStarted = false
      quitting = false
      dialog.showErrorBox('Could not close Render Farm', error.message)
    })
})

app.on('window-all-closed', () => {
  app.quit()
})
