import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { AppKind, Install } from '../../shared/types'

const isWin = process.platform === 'win32'
const isMac = process.platform === 'darwin'

function exe(name: string): string {
  return isWin ? `${name}.exe` : name
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function mayaVersionFromPath(p: string): string {
  const m = /maya\s*(\d{4}(?:\.\d+)?)/i.exec(p)
  return m ? m[1] : 'unknown'
}

function mayaFromBin(binDir: string, source: 'auto' | 'manual', renderOverride?: string): Install | null {
  const render = renderOverride ?? path.join(binDir, exe('Render'))
  if (!isFile(render)) return null
  const mayapy = path.join(path.dirname(render), exe('mayapy'))
  return {
    id: `${source}:${render}`,
    app: 'maya',
    version: mayaVersionFromPath(render),
    renderPath: render,
    mayapyPath: isFile(mayapy) ? mayapy : null,
    source
  }
}

const versionCache = new Map<string, string>()

function blenderVersionOf(bin: string): string {
  const fromPath = /blender[\s_-]*(\d+\.\d+)/i.exec(bin)
  if (fromPath) return fromPath[1]
  const cached = versionCache.get(bin)
  if (cached) return cached
  let v = 'unknown'
  try {
    const out = execFileSync(bin, ['--version'], {
      timeout: 15000,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const m = /Blender\s+(\d+\.\d+)/.exec(out)
    if (m) v = m[1]
  } catch {
    v = 'unknown'
  }
  versionCache.set(bin, v)
  return v
}

function blenderAt(bin: string, source: 'auto' | 'manual'): Install | null {
  if (!isFile(bin)) return null
  return { id: `${source}:${bin}`, app: 'blender', version: blenderVersionOf(bin), renderPath: bin, mayapyPath: null, source }
}

function blenderCandidates(): string[] {
  const out: string[] = []
  if (isWin) {
    const roots = [process.env['ProgramFiles'], process.env['ProgramW6432'], 'C:\\Program Files'].filter((r): r is string => !!r)
    for (const r of [...new Set(roots)]) {
      const base = path.join(r, 'Blender Foundation')
      for (const d of listDir(base)) out.push(path.join(base, d, 'blender.exe'))
    }
    const steam = [process.env['ProgramFiles(x86)'], 'C:\\Program Files (x86)'].filter((r): r is string => !!r)
    for (const r of [...new Set(steam)]) out.push(path.join(r, 'Steam', 'steamapps', 'common', 'Blender', 'blender.exe'))
  } else if (isMac) {
    for (const root of ['/Applications', path.join(process.env.HOME ?? '', 'Applications')])
      for (const d of listDir(root))
        if (/^blender/i.test(d) && d.endsWith('.app')) out.push(path.join(root, d, 'Contents', 'MacOS', 'Blender'))
  } else {
    out.push('/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender')
    for (const d of listDir('/opt')) if (/^blender/i.test(d)) out.push(path.join('/opt', d, 'blender'))
  }
  return out
}

export function manualInstall(p: string): Install | null {
  let target = p
  try {
    if (/\.app\/?$/i.test(p)) {
      const mac = [path.join(p, 'Contents', 'MacOS', 'Blender'), path.join(p, 'Contents', 'bin', 'Render')].find(isFile)
      if (!mac) return null
      return mac.endsWith('Blender') ? blenderAt(mac, 'manual') : mayaFromBin(path.dirname(mac), 'manual', mac)
    }
    if (fs.statSync(p).isDirectory()) {
      const blender = [exe('blender'), 'Blender'].map((n) => path.join(p, n)).find(isFile)
      const render = [path.join(p, exe('Render')), path.join(p, 'bin', exe('Render'))].find(isFile)
      target = blender ?? render ?? p
    }
  } catch {
    return null
  }
  if (/^blender(\.exe)?$/i.test(path.basename(target))) return blenderAt(target, 'manual')
  if (/^Render(\.exe)?$/i.test(path.basename(target))) return mayaFromBin(path.dirname(target), 'manual', target)
  return null
}

export function installPathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = (platform === 'win32' ? path.win32 : path.posix).resolve(p)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function detectInstalls(manual: string[]): Install[] {
  const found: Install[] = []
  const seen = new Set<string>()
  const push = (i: Install | null) => {
    if (!i) return
    const key = installPathKey(i.renderPath)
    if (seen.has(key)) return
    seen.add(key)
    found.push(i)
  }
  if (process.env.MAYA_LOCATION) push(mayaFromBin(path.join(process.env.MAYA_LOCATION, 'bin'), 'auto'))
  if (isWin) {
    const roots = [process.env['ProgramFiles'], process.env['ProgramW6432'], 'C:\\Program Files']
      .filter((r): r is string => !!r)
      .map((r) => path.join(r, 'Autodesk'))
    for (const root of [...new Set(roots)]) {
      for (const d of listDir(root)) {
        if (/^maya\s*\d{4}/i.test(d)) push(mayaFromBin(path.join(root, d, 'bin'), 'auto'))
      }
    }
  } else if (isMac) {
    const root = '/Applications/Autodesk'
    for (const d of listDir(root)) {
      if (/^maya\d{4}/i.test(d)) push(mayaFromBin(path.join(root, d, 'Maya.app', 'Contents', 'bin'), 'auto'))
    }
  } else {
    const root = '/usr/autodesk'
    for (const d of listDir(root)) {
      if (/^maya\d{4}/i.test(d)) push(mayaFromBin(path.join(root, d, 'bin'), 'auto'))
    }
  }
  for (const c of blenderCandidates()) push(blenderAt(c, 'auto'))
  for (const m of manual) push(manualInstall(m))
  return found.sort((a, b) =>
    a.app === b.app ? b.version.localeCompare(a.version, undefined, { numeric: true }) : a.app.localeCompare(b.app)
  )
}

export interface InstallChoice {
  install: Install | null
  mismatch: boolean
}

function mayaMajor(v: string): string {
  const m = /(\d{4})/.exec(v)
  return m ? m[1] : v
}

export function versionNum(v: string | null | undefined): number {
  const m = /(\d+)\.(\d+)/.exec(v ?? '')
  return m ? Number(m[1]) * 1000 + Number(m[2]) : 0
}

export function chooseInstall(all: Install[], app: AppKind, requested: string, sceneVersion: string | null): InstallChoice {
  const installs = all.filter((i) => i.app === app)
  if (!installs.length) return { install: null, mismatch: false }
  if (app === 'blender') {
    const scene = versionNum(sceneVersion)
    const older = (i: Install) => !!scene && i.version !== 'unknown' && versionNum(i.version) < scene
    if (requested && requested !== 'auto') {
      const exact = installs.find((i) => i.id === requested) || installs.find((i) => i.version === requested)
      if (exact) return { install: exact, mismatch: older(exact) }
    }
    if (scene) {
      const same = installs.find((i) => versionNum(i.version) === scene)
      if (same) return { install: same, mismatch: false }
      const newer = installs.filter((i) => versionNum(i.version) > scene).sort((a, b) => versionNum(a.version) - versionNum(b.version))[0]
      if (newer) return { install: newer, mismatch: false }
    }
    return { install: installs[0], mismatch: older(installs[0]) }
  }
  if (requested && requested !== 'auto') {
    const exact = installs.find((i) => i.id === requested) || installs.find((i) => i.version === requested)
    if (exact) {
      const mismatch = !!sceneVersion && mayaMajor(sceneVersion) !== mayaMajor(exact.version) && exact.version !== 'unknown'
      return { install: exact, mismatch }
    }
  }
  if (sceneVersion) {
    const want = mayaMajor(sceneVersion)
    const same = installs.find((i) => mayaMajor(i.version) === want)
    if (same) return { install: same, mismatch: false }
    const newer = [...installs].reverse().find((i) => Number(mayaMajor(i.version)) > Number(want))
    if (newer) return { install: newer, mismatch: true }
    return { install: installs[0], mismatch: installs[0].version !== 'unknown' }
  }
  return { install: installs[0], mismatch: false }
}
