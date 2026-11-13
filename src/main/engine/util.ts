import { randomBytes } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import type { AppKind } from '../../shared/types'

export function uid(prefix = ''): string {
  return prefix + Date.now().toString(36) + randomBytes(4).toString('hex')
}

export function toSlash(p: string): string {
  return p.replace(/\\/g, '/')
}

export function sceneNameOf(p: string): string {
  return path.basename(p).replace(/\.(ma|mb|blend)$/i, '')
}

export function isSceneFile(p: string): boolean {
  return /\.(ma|mb|blend)$/i.test(p)
}

export function appOf(p: string): AppKind {
  return /\.blend$/i.test(p) ? 'blender' : 'maya'
}

export const APP_LABEL: Record<AppKind, string> = { maya: 'Maya', blender: 'Blender' }

export function hasNonAscii(s: string): boolean {
  return /[^\x00-\x7F]/.test(s)
}

const NT_STATUS: Record<number, string> = {
  0xc0000005: 'Access violation',
  0xc0000017: 'Out of memory',
  0xc00000fd: 'Stack overflow',
  0xc000013a: 'Process terminated',
  0xc0000374: 'Heap corruption',
  0xc0000409: 'Buffer overrun'
}

export function describeExit(code: number | null, signal: string | null, exe = 'Render.exe'): string {
  if (code === null) return signal ? `${exe} exited unexpectedly (${signal})` : `${exe} exited unexpectedly`
  const u = code >>> 0
  if (u >= 0xc0000000) {
    const name = NT_STATUS[u]
    return `${exe} exited unexpectedly (0x${u.toString(16).toUpperCase()}${name ? `, ${name}` : ''})`
  }
  return `Exit code: ${code}`
}

export const LICENSE_FAIL_RE =
  /abort_on_license_fail|not licensed|license (?:check(?:out)?|server)? ?(?:failed|failure|error|denied)|no (?:valid )?license (?:found|available)/i

export function nonAsciiPart(p: string): string | null {
  return p.split(/[\\/]/).find((seg) => hasNonAscii(seg)) ?? null
}

export function frameList(start: number, end: number, step: number): number[] {
  const s = Math.round(start)
  const e = Math.round(end)
  const st = Math.max(1, Math.round(step))
  const out: number[] = []
  if (e < s) return [s]
  for (let f = s; f <= e; f += st) out.push(f)
  return out
}

export interface FrameRange {
  start: number
  end: number
  step: number
}

export function toRanges(frames: number[], step: number, chunk: number): FrameRange[] {
  const sorted = [...new Set(frames)].sort((a, b) => a - b)
  const runs: number[][] = []
  for (const f of sorted) {
    const run = runs[runs.length - 1]
    if (run && f - run[run.length - 1] === step) run.push(f)
    else runs.push([f])
  }
  const ranges: FrameRange[] = []
  for (const run of runs) {
    const size = chunk > 0 ? chunk : run.length
    for (let i = 0; i < run.length; i += size) {
      const part = run.slice(i, i + size)
      ranges.push({ start: part[0], end: part[part.length - 1], step })
    }
  }
  return ranges
}

export function rangeFrames(r: FrameRange): number[] {
  return frameList(r.start, r.end, r.step)
}

export function compactFrames(frames: number[]): string {
  const sorted = [...new Set(frames)].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : `${sorted[i]}`)
    i = j + 1
  }
  return parts.join(', ')
}

function safeToken(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
}

export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

export function resolveTokens(pattern: string, vars: { scene: string; camera: string; project: string }): string {
  return pattern
    .replace(/\{scene\}/gi, safeToken(vars.scene))
    .replace(/\{camera\}/gi, safeToken(vars.camera.split('|').pop() || 'camera'))
    .replace(/\{project\}/gi, safeToken(vars.project || 'project'))
    .replace(/\{date\}/gi, today())
}

export function findProjectDir(scenePath: string): string | null {
  let dir = path.dirname(scenePath)
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'workspace.mel'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

export function splitArgs(s: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

export function quoteArg(a: string): string {
  return /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a
}

export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
