import type { AppSettings, Job, RenderSettings, SceneInfo } from '../../shared/types'

export const DEFAULT_RENDER: RenderSettings = {
  outputRoot: '',
  folderPattern: '{scene}',
  filePrefix: '{scene}',
  format: 'exr',
  renderer: 'scene',
  mayaVersion: 'auto',
  blenderVersion: 'auto',
  device: 'auto',
  camera: '',
  layers: null,
  frameMode: 'scene',
  start: 1,
  end: 120,
  step: 1,
  resolutionMode: 'scene',
  width: 1920,
  height: 1080,
  padding: 4,
  skipExisting: false,
  chunkSize: 0,
  makePreview: false,
  previewFps: 0,
  extraArgs: ''
}

export const DEFAULT_APP: AppSettings = {
  manualInstalls: [],
  concurrency: 1,
  threadsPerTask: 0,
  maxRetries: 2,
  arnoldVerbosity: 2,
  completionAction: 'none',
  completionKind: 'shutdown',
  lockPinHash: '',
  completionOnFailure: true,
  countdownSeconds: 60,
  notifications: true,
  keepAwake: true,
  ffmpegPath: '',
  logEncoding: 'auto',
  deepProbe: true,
  inspectorWidth: 360,
  logHeight: 200,
  logOpen: false
}

export function emptySceneInfo(): SceneInfo {
  return {
    state: 'pending',
    method: null,
    version: null,
    renderer: null,
    start: null,
    end: null,
    step: null,
    animation: null,
    timelineStart: null,
    timelineEnd: null,
    width: null,
    height: null,
    fps: null,
    imagePrefix: null,
    imageFormat: null,
    cameras: [],
    layers: [],
    references: [],
    plugins: [],
    error: null,
    deep: false
  }
}

export function effectiveSettings(global: RenderSettings, job: Job): RenderSettings {
  const merged: RenderSettings = { ...global }
  for (const [k, v] of Object.entries(job.overrides)) {
    if (v !== undefined) (merged as unknown as Record<string, unknown>)[k] = v
  }
  return merged
}

export function sanitizeRender(input: Partial<RenderSettings>): Partial<RenderSettings> {
  const out: Partial<RenderSettings> = {}
  for (const [k, v] of Object.entries(input)) {
    if (!(k in DEFAULT_RENDER)) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  if (out.step !== undefined) out.step = Math.max(1, Math.round(Number(out.step) || 1))
  if (out.padding !== undefined) out.padding = Math.min(8, Math.max(1, Math.round(Number(out.padding) || 4)))
  if (out.chunkSize !== undefined) out.chunkSize = Math.max(0, Math.round(Number(out.chunkSize) || 0))
  if (out.width !== undefined) out.width = Math.max(16, Math.round(Number(out.width) || 1920))
  if (out.height !== undefined) out.height = Math.max(16, Math.round(Number(out.height) || 1080))
  if (out.start !== undefined) out.start = Math.round(Number(out.start) || 0)
  if (out.end !== undefined) out.end = Math.round(Number(out.end) || 0)
  if (out.previewFps !== undefined) out.previewFps = Math.max(0, Number(out.previewFps) || 0)
  return out
}

export function sanitizeApp(input: Partial<AppSettings>): Partial<AppSettings> {
  const out: Partial<AppSettings> = {}
  for (const [k, v] of Object.entries(input)) {
    if (!(k in DEFAULT_APP)) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  if (out.concurrency !== undefined) out.concurrency = Math.min(16, Math.max(1, Math.round(Number(out.concurrency) || 1)))
  if (out.threadsPerTask !== undefined) out.threadsPerTask = Math.max(0, Math.round(Number(out.threadsPerTask) || 0))
  if (out.maxRetries !== undefined) out.maxRetries = Math.min(10, Math.max(0, Math.round(Number(out.maxRetries) || 0)))
  if (out.countdownSeconds !== undefined) out.countdownSeconds = Math.min(600, Math.max(5, Math.round(Number(out.countdownSeconds) || 60)))
  if (out.arnoldVerbosity !== undefined) out.arnoldVerbosity = Math.min(3, Math.max(0, Math.round(Number(out.arnoldVerbosity) || 0)))
  return out
}

export const TIME_UNIT_FPS: Record<string, number> = {
  game: 15,
  film: 24,
  pal: 25,
  ntsc: 30,
  show: 48,
  palf: 50,
  ntscf: 60,
  '23.976fps': 23.976,
  '29.97fps': 29.97,
  '29.97df': 29.97,
  '47.952fps': 47.952,
  '59.94fps': 59.94,
  '44100fps': 44100,
  '48000fps': 48000
}

export function fpsFromUnit(unit: string | null | undefined): number | null {
  if (!unit) return null
  if (TIME_UNIT_FPS[unit] !== undefined) return TIME_UNIT_FPS[unit]
  const m = /^([\d.]+)fps$/.exec(unit)
  return m ? Number(m[1]) : null
}
