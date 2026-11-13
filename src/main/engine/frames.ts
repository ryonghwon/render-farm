import fs from 'node:fs'
import path from 'node:path'
import { IMAGE_EXTS } from '../../shared/types'

export interface FrameFile {
  frame: number
  path: string
  stem: string
  ext: string
  mtimeMs: number
  size: number
  depth: number
}

const FRAME_RE = new RegExp(`^(.*?)([._])(-?\\d+)\\.(${IMAGE_EXTS.join('|')})$`, 'i')

export function parseFrameName(name: string): { stem: string; sep: string; frame: number; ext: string; digits: number } | null {
  const m = FRAME_RE.exec(name)
  if (!m) return null
  return { stem: m[1], sep: m[2], frame: Number(m[3]), ext: m[4].toLowerCase(), digits: m[3].replace('-', '').length }
}

export function scanFrames(dir: string, hint: string, maxDepth = 4): FrameFile[] {
  const out: FrameFile[] = []
  const walk = (d: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) {
        if (depth < maxDepth && !e.name.startsWith('.')) walk(full, depth + 1)
        continue
      }
      const p = parseFrameName(e.name)
      if (!p) continue
      if (hint && !p.stem.toLowerCase().includes(hint.toLowerCase())) continue
      let st: fs.Stats
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      out.push({ frame: p.frame, path: full, stem: p.stem, ext: p.ext, mtimeMs: st.mtimeMs, size: st.size, depth })
    }
  }
  walk(dir, 0)
  return dropAuxAovs(out)
}

const MAIN_AOVS = new Set(['beauty', 'rgba'])

export function dropAuxAovs(files: FrameFile[]): FrameFile[] {
  const roots = new Set(
    files.filter((f) => MAIN_AOVS.has(path.basename(path.dirname(f.path)).toLowerCase())).map((f) => path.dirname(path.dirname(f.path)))
  )
  if (!roots.size) return files
  return files.filter((f) => {
    const dir = path.dirname(f.path)
    return MAIN_AOVS.has(path.basename(dir).toLowerCase()) || !roots.has(path.dirname(dir))
  })
}

export function prefixHint(prefix: string): string {
  const base = prefix.split(/[\\/]/).pop() || ''
  const cut = base.indexOf('<')
  return (cut >= 0 ? base.slice(0, cut) : base).replace(/[._]+$/, '')
}

export function framesPresent(files: FrameFile[], since = 0): Map<number, FrameFile> {
  const map = new Map<number, FrameFile>()
  for (const f of files) {
    if (f.size <= 0) continue
    if (since && f.mtimeMs < since) continue
    const cur = map.get(f.frame)
    if (!cur || f.depth < cur.depth || (f.depth === cur.depth && f.mtimeMs > cur.mtimeMs)) map.set(f.frame, f)
  }
  return map
}

export interface Sequence {
  dir: string
  stem: string
  sep: string
  ext: string
  digits: number
  frames: number[]
}

export function primarySequence(files: FrameFile[], preferStem = ''): Sequence | null {
  const groups = new Map<string, Sequence & { depth: number }>()
  for (const f of files) {
    const p = parseFrameName(path.basename(f.path))
    if (!p) continue
    const key = `${path.dirname(f.path)}|${p.stem}|${p.ext}`
    const g = groups.get(key) || {
      dir: path.dirname(f.path),
      stem: p.stem,
      sep: p.sep,
      ext: p.ext,
      frames: [],
      depth: f.depth,
      digits: p.digits
    }
    g.frames.push(f.frame)
    groups.set(key, g)
  }
  let best: (Sequence & { depth: number }) | null = null
  const exact = [...groups.values()].filter((g) => preferStem && g.stem === preferStem)
  for (const g of exact.length ? exact : groups.values()) {
    if (!best || g.depth < best.depth || (g.depth === best.depth && g.frames.length > best.frames.length)) best = g
  }
  if (!best) return null
  return { dir: best.dir, stem: best.stem, sep: best.sep, ext: best.ext, digits: best.digits, frames: best.frames.sort((a, b) => a - b) }
}
