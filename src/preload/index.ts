import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppInfo,
  AppSettings,
  CompletionAction,
  JobPatch,
  LogLine,
  Preset,
  PreviewInfo,
  RenderSettings,
  Snapshot
} from '../shared/types'

type AddResult = { added: number; skipped: number }

const inv = <T = void>(ch: string, ...args: unknown[]) => ipcRenderer.invoke(ch, ...args) as Promise<T>

const api = {
  getState: () => inv<Snapshot>('state:get'),
  onState: (cb: (s: Snapshot) => void) => {
    const fn = (_: unknown, s: Snapshot) => cb(s)
    ipcRenderer.on('state', fn)
    return () => ipcRenderer.removeListener('state', fn)
  },
  onLog: (cb: (lines: LogLine[]) => void) => {
    const fn = (_: unknown, l: LogLine[]) => cb(l)
    ipcRenderer.on('log', fn)
    return () => ipcRenderer.removeListener('log', fn)
  },
  getLog: (jobId: string | null) => inv<LogLine[]>('log:get', jobId),
  addPaths: (paths: string[]) => inv<AddResult>('jobs:add', paths),
  pickFiles: () => inv<AddResult>('jobs:pickFiles'),
  pickFolder: () => inv<AddResult>('jobs:pickFolder'),
  removeJobs: (ids: string[]) => inv('jobs:remove', ids),
  reorderJobs: (ids: string[]) => inv('jobs:reorder', ids),
  moveJobs: (ids: string[], where: 'top' | 'bottom') => inv('jobs:move', ids, where),
  duplicateJobs: (ids: string[]) => inv('jobs:duplicate', ids),
  updateJobs: (ids: string[], patch: JobPatch) => inv('jobs:update', ids, patch),
  resetJobs: (ids: string[], mode: 'full' | 'missing') => inv('jobs:reset', ids, mode),
  reprobe: (ids: string[], deep: boolean) => inv('jobs:reprobe', ids, deep),
  clearFinished: () => inv('jobs:clearFinished'),
  skip: (ids: string[]) => inv('jobs:skip', ids),
  updateGlobal: (patch: Partial<RenderSettings>) => inv('global:update', patch),
  updateApp: (patch: Partial<AppSettings>) => inv('app:update', patch),
  start: () => inv('render:start'),
  pause: () => inv('render:pause'),
  resume: () => inv('render:resume'),
  stop: () => inv('render:stop'),
  setCompletion: (a: CompletionAction) => inv('completion:set', a),
  cancelCountdown: () => inv('completion:cancel'),
  completeNow: () => inv('completion:now'),
  savePreset: (name: string) => inv<Preset | null>('preset:save', name),
  unlock: (pin: string) => inv<boolean>('lock:unlock', pin),
  lockNow: () => inv('lock:now'),
  setPin: (pin: string | null) => inv<boolean>('lock:setPin', pin),
  applyPreset: (id: string) => inv('preset:apply', id),
  deletePreset: (id: string) => inv('preset:delete', id),
  detectApps: () => inv('apps:detect'),
  addInstall: (app: 'maya' | 'blender') => inv('apps:add', app),
  removeInstall: (id: string) => inv('apps:remove', id),
  pickOutputDir: (current?: string) => inv<string | null>('dialog:outputDir', current),
  pickFfmpeg: () => inv<string | null>('dialog:ffmpeg'),
  openPath: (p: string) => inv('shell:open', p),
  showItem: (p: string) => inv('shell:show', p),
  getPreview: (jobId: string) => inv<PreviewInfo>('preview:get', jobId),
  appInfo: () => inv<AppInfo>('app:info'),
  openLogs: (jobId: string | null) => inv('logs:dir', jobId),
  pathForFile: (f: File) => webUtils.getPathForFile(f)
}

export type RdApi = typeof api

contextBridge.exposeInMainWorld('rd', api)
