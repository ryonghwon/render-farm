import type { AppKind, CompletionAction, Job, JobStatus } from '@shared/types'

export const APP_LABEL: Record<AppKind, string> = { maya: 'Maya', blender: 'Blender' }

export const STATUS_LABEL: Record<JobStatus, string> = {
  idle: 'Queued',
  rendering: 'Rendering',
  done: 'Complete',
  partial: 'Missing frames',
  failed: 'Failed',
  stopped: 'Stopped',
  skipped: 'Skipped'
}

export function waitLabel(j: Job): string | null {
  if (j.status !== 'rendering' || j.tasks.some((t) => t.status === 'running')) return null
  const pending = j.tasks.filter((t) => t.status === 'pending')
  if (!pending.length) return null
  return pending.some((t) => (t.licenseTries ?? 0) > 0) ? 'Waiting for license' : 'Waiting for next render'
}

export function jobStatusLabel(j: Job): string {
  if (j.info.state === 'running' || j.info.state === 'pending') return 'Inspecting'
  if (!j.enabled && j.status === 'idle') return 'Excluded'
  return STATUS_LABEL[j.status]
}

export function jobTone(j: Job): string {
  if (!j.enabled && j.status === 'idle') return 'muted'
  switch (j.status) {
    case 'rendering':
      return 'active'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'partial':
    case 'stopped':
      return 'attention'
    case 'skipped':
      return 'muted'
    default:
      return 'idle'
  }
}

const RENDERER_LABEL: Record<string, string> = {
  arnold: 'Arnold',
  mayaSoftware: 'Maya Software',
  sw: 'Maya Software',
  mayaHardware2: 'Hardware 2.0',
  hw2: 'Hardware 2.0',
  redshift: 'Redshift',
  vray: 'V-Ray',
  renderman: 'RenderMan',
  cycles: 'Cycles',
  eevee: 'EEVEE',
  workbench: 'Workbench',
  file: 'Use scene setting',
  scene: 'Use scene setting'
}

export function rendererLabel(r: string | null | undefined): string {
  if (!r) return 'Unknown'
  return RENDERER_LABEL[r] ?? r
}

export const ACTION_LABEL: Record<CompletionAction, string> = {
  none: 'None',
  sleep: 'Sleep',
  shutdown: 'Shut down',
  quit: 'Quit Render Farm'
}

export function duration(ms: number | null | undefined, approx = false): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-'
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const prefix = approx ? 'About ' : ''
  if (h) return `${prefix}${h}h ${m}m`
  if (m) return `${prefix}${m}m ${approx ? '' : `${sec}s`}`.trim()
  return approx ? 'Less than a minute' : `${sec}s`
}

export function clock(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function num(n: number): string {
  return n.toLocaleString('en-US')
}

export function frameRange(frames: number[]): string {
  if (!frames.length) return '-'
  const a = frames[0]
  const b = frames[frames.length - 1]
  return a === b ? `${a}` : `${a}-${b}`
}

export const FORMAT_INFO: Record<string, { label: string; short: string; desc: string }> = {
  exr: {
    label: 'EXR',
    short: 'High-precision compositing image',
    desc: 'High dynamic range output for compositing. Preserves precision and produces larger files.'
  },
  png: {
    label: 'PNG',
    short: 'Lossless image for review and editing',
    desc: 'Lossless compression with alpha support for review and editing.'
  },
  jpg: { label: 'JPEG', short: 'Compressed image for previews', desc: 'Smaller preview files with lossy compression.' },
  tif: { label: 'TIFF', short: 'Lossless archival image', desc: 'Lossless output for archiving and interchange.' },
  scene: {
    label: 'Use scene setting',
    short: "Use the scene's output format",
    desc: "Uses the file format configured in the scene's render settings."
  }
}

export function shortPath(p: string | null | undefined, keep = 3): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  if (parts.length <= keep + 1) return p
  return `…/${parts.slice(-keep).join('/')}`
}

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
