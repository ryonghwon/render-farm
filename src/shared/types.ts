export type FormatKey = 'scene' | 'exr' | 'png' | 'tif' | 'jpg'
export type RendererKey = 'scene' | 'arnold' | 'sw' | 'hw2' | 'redshift' | 'vray'
export type FrameMode = 'scene' | 'timeline' | 'custom'
export type ResolutionMode = 'scene' | 'custom'
export type CompletionAction = 'none' | 'sleep' | 'shutdown' | 'quit'
export type JobStatus = 'idle' | 'rendering' | 'done' | 'partial' | 'failed' | 'stopped' | 'skipped'
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'stopped'
export type ProbeState = 'pending' | 'running' | 'done' | 'error'
export type LogLevel = 'info' | 'warn' | 'error' | 'system' | 'progress'
export type RunMode = 'full' | 'missing'
export type AppKind = 'maya' | 'blender'
export type DeviceKey = 'auto' | 'cpu' | 'scene'

export interface RenderSettings {
  outputRoot: string
  folderPattern: string
  filePrefix: string
  format: FormatKey
  renderer: RendererKey
  mayaVersion: string
  blenderVersion: string
  device: DeviceKey
  camera: string
  layers: string[] | null
  frameMode: FrameMode
  start: number
  end: number
  step: number
  resolutionMode: ResolutionMode
  width: number
  height: number
  padding: number
  skipExisting: boolean
  chunkSize: number
  makePreview: boolean
  previewFps: number
  extraArgs: string
}

export type SettingsKey = keyof RenderSettings

export interface Install {
  id: string
  app: AppKind
  version: string
  renderPath: string
  mayapyPath: string | null
  source: 'auto' | 'manual'
}

export interface AppSettings {
  manualInstalls: string[]
  concurrency: number
  threadsPerTask: number
  maxRetries: number
  arnoldVerbosity: number
  completionAction: CompletionAction
  completionKind: Exclude<CompletionAction, 'none'>
  lockPinHash: string
  completionOnFailure: boolean
  countdownSeconds: number
  notifications: boolean
  keepAwake: boolean
  ffmpegPath: string
  logEncoding: 'auto' | 'utf8' | 'cp949'
  deepProbe: boolean
  inspectorWidth: number
  logHeight: number
  logOpen: boolean
}

export interface Preset {
  id: string
  name: string
  settings: RenderSettings
}

export interface CameraInfo {
  name: string
  renderable: boolean
}

export interface LayerInfo {
  name: string
  renderable: boolean
}

export interface ReferenceInfo {
  path: string
  resolved: string
  exists: boolean
}

export interface SceneInfo {
  state: ProbeState
  method: 'ascii' | 'binary' | 'mayapy' | 'blend' | 'blender' | null
  parserVersion?: number
  version: string | null
  sceneName?: string | null
  missingFiles?: string[]
  renderer: string | null
  start: number | null
  end: number | null
  step: number | null
  animation: boolean | null
  timelineStart: number | null
  timelineEnd: number | null
  width: number | null
  height: number | null
  fps: number | null
  imagePrefix: string | null
  imageFormat: string | null
  cameras: CameraInfo[]
  layers: LayerInfo[]
  references: ReferenceInfo[]
  plugins: string[]
  error: string | null
  deep: boolean
}

export interface IssueFix {
  label: string
  patch?: Partial<RenderSettings>
  action?: 'details'
}

export interface Issue {
  level: 'error' | 'warn' | 'info'
  code: string
  message: string
  fix?: IssueFix
}

export interface Task {
  id: string
  start: number
  end: number
  step: number
  status: TaskStatus
  attempt: number
  pid: number | null
  startedAt: number | null
  finishedAt: number | null
  exitCode: number | null
  logPath: string | null
  error: string | null
  currentFrame: number | null
  percent: number
  notBefore?: number | null
  licenseTries?: number
}

export interface Job {
  id: string
  scenePath: string
  sceneName: string
  app: AppKind
  enabled: boolean
  status: JobStatus
  runMode: RunMode
  overwrite: boolean
  overrides: Partial<RenderSettings>
  info: SceneInfo
  project: string | null
  frames: number[]
  doneFrames: number[]
  missingFrames: number[]
  tasks: Task[]
  outputDir: string | null
  outputExample: string | null
  versionUsed: string | null
  issues: Issue[]
  dismissed: string[]
  error: string | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  elapsedMs: number
  avgFrameMs: number | null
  loadMs?: number | null
  etaMs: number | null
  lastFrame: { frame: number; path: string } | null
  previewVideo: string | null
}

export interface QueueStats {
  totalFrames: number
  doneFrames: number
  progress: number
  elapsedMs: number
  etaMs: number | null
  etaEstimated: boolean
  runningTasks: number
  jobsTotal: number
  jobsDone: number
  jobsFailed: number
}

export interface CompletionState {
  action: CompletionAction
  countdown: number | null
  pendingAction: CompletionAction | null
}

export interface Snapshot {
  jobs: Job[]
  running: boolean
  paused: boolean
  global: RenderSettings
  app: AppSettings
  presets: Preset[]
  installs: Install[]
  stats: QueueStats
  completion: CompletionState
  runStartedAt: number | null
  awake: boolean
  lock: LockState
}

export interface LogLine {
  t: number
  level: LogLevel
  text: string
  jobId: string | null
  taskId: string | null
  raw?: boolean
}

export interface JobPatch {
  enabled?: boolean
  overrides?: Partial<RenderSettings>
  clear?: SettingsKey[]
  dismiss?: string[]
}

export interface LockState {
  enabled: boolean
  locked: boolean
}

export interface PreviewInfo {
  frame: number | null
  path: string | null
  dataUrl: string | null
  video: string | null
  message: string | null
}

export interface AppInfo {
  version: string
  platform: string
  dataDir: string
  cores: number
  electron: string
}

export const FORMAT_EXT: Record<Exclude<FormatKey, 'scene'>, string> = {
  exr: 'exr',
  png: 'png',
  tif: 'tif',
  jpg: 'jpg'
}

export const IMAGE_EXTS = ['exr', 'png', 'tif', 'tiff', 'jpg', 'jpeg', 'iff', 'tga', 'bmp', 'dpx', 'hdr', 'deepexr', 'psd']
