import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  AppKind,
  AppSettings,
  CompletionAction,
  CompletionState,
  Install,
  Job,
  JobPatch,
  LogLevel,
  LogLine,
  Preset,
  QueueStats,
  RenderSettings,
  SceneInfo,
  Snapshot,
  Task
} from '../../shared/types'
import { BLEND_PARSER_VERSION, probeBlend, probeBlenderDeep } from './blend'
import { BLENDER_PROBE_PY, buildCommand, expectedExt, resolvedOutputDir, resolvedPrefix } from './command'
import { encodePreview, findFfmpeg } from './ffmpeg'
import { framesPresent, prefixHint, primarySequence, scanFrames, type FrameFile } from './frames'
import { chooseInstall, detectInstalls, installPathKey, manualInstall } from './installs'
import { runPowerAction } from './power'
import { computeIssues } from './preflight'
import { PARSER_VERSION, PROBE_PY, probeAscii, probeBinary, probeDeep, resolveRefs } from './probe'
import { RenderProcess, detectConsoleEncoding, type RunnerEvent } from './runner'
import { DEFAULT_APP, DEFAULT_RENDER, effectiveSettings, emptySceneInfo, sanitizeApp, sanitizeRender } from './settings'
import {
  APP_LABEL,
  LICENSE_FAIL_RE,
  appOf,
  compactFrames,
  describeExit,
  findProjectDir,
  frameList,
  isSceneFile,
  quoteArg,
  rangeFrames,
  readJson,
  sceneNameOf,
  toRanges,
  uid,
  writeJsonAtomic
} from './util'

interface PersistShape {
  version: number
  jobs: Job[]
  global: RenderSettings
  app: AppSettings
  presets: Preset[]
}

interface TaskCtx {
  job: Job
  task: Task
  proc: RenderProcess
  stream: fs.WriteStream | null
  outputDir: string
  hint: string
  since: number
  written: Set<number>
  confirmed: Set<number>
  lastConfirmAt: number
  expected: number[]
  errors: number
  licenseFail: boolean
  loadEnd: number | null
  firstDt: number | null
}

export interface EngineOptions {
  discoverInstalls?: typeof detectInstalls
  dataDir: string
  retryDelays?: { license: number; crash: number; missing: number }
  dryRunPower?: boolean
  cores?: number
}

const SYSTEM_LOG = '__system'
const STUDENT_KEYS = new Set<keyof RenderSettings>(['frameMode', 'start', 'end', 'step', 'camera', 'layers'])
const STUDENT_APP_KEYS = new Set<keyof AppSettings>(['completionAction', 'logOpen', 'logHeight', 'inspectorWidth'])

const LICENSE_TRIES = 3

function hashPin(pin: string): string {
  return createHash('sha256').update(`renderdock:${pin}`).digest('hex')
}
const LOG_CAP = 4000

export class Engine extends EventEmitter {
  jobs: Job[] = []
  global: RenderSettings = { ...DEFAULT_RENDER }
  app: AppSettings = { ...DEFAULT_APP }
  presets: Preset[] = []
  installs: Install[] = []
  running = false
  paused = false
  runStartedAt: number | null = null
  completion: CompletionState = { action: 'none', countdown: null, pendingAction: null }

  private readonly discoverInstalls: typeof detectInstalls
  private readonly dataDir: string
  private readonly dryRunPower: boolean
  private readonly cores: number
  private readonly stateFile: string
  private ctxs = new Map<string, TaskCtx>()
  private runSet = new Set<string>()
  private logs = new Map<string, LogLine[]>()
  private pendingLog: LogLine[] = []
  private logTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private watchTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private readonly retryDelays: { license: number; crash: number; missing: number }
  private countdownTimer: NodeJS.Timeout | null = null
  private probeQueue: { id: string; deep: boolean }[] = []
  private probeActive = 0
  private deepActive = false
  private frameTimes = new Map<string, number[]>()
  private encoding = 'utf8'
  private stopRequested = false
  private runHadFailure = false
  private runTasksStarted = 0
  private lastSessionEndAt = 0
  private licenseGapMs = 0
  private gapNotedUntil = 0
  private disposed = false
  private sessionUnlocked = false

  constructor(opts: EngineOptions) {
    super()
    this.discoverInstalls = opts.discoverInstalls ?? detectInstalls
    this.dataDir = opts.dataDir
    this.retryDelays = opts.retryDelays ?? { license: 60000, crash: 20000, missing: 5000 }
    this.dryRunPower = !!opts.dryRunPower
    this.cores = opts.cores ?? os.cpus().length
    this.stateFile = path.join(this.dataDir, 'state.json')
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.dataDir, { recursive: true })
    const saved = readJson<PersistShape | null>(this.stateFile, null)
    if (saved) {
      this.global = { ...DEFAULT_RENDER, ...saved.global }
      this.app = { ...DEFAULT_APP, ...saved.app }
      this.presets = saved.presets ?? []
      this.jobs = (saved.jobs ?? []).map((j) => this.restoreJob(j))
    }
    this.app.completionAction = 'none'
    this.completion.action = 'none'
    fs.writeFileSync(path.join(this.dataDir, 'probe.py'), PROBE_PY, 'utf8')
    fs.writeFileSync(path.join(this.dataDir, 'blender_probe.py'), BLENDER_PROBE_PY, 'utf8')
    this.installs = this.discoverInstalls(this.app.manualInstalls)
    this.encoding = await detectConsoleEncoding(this.app.logEncoding)
    this.syslog('system', `Engine started: ${this.installSummary()}; log encoding: ${this.encoding}`)
    for (const j of this.jobs) {
      if (j.status === 'rendering') continue
      if (j.info.method === 'ascii' && (j.info.parserVersion ?? 1) < PARSER_VERSION) j.info = { ...emptySceneInfo() }
      if (j.info.method === 'blend' && (j.info.parserVersion ?? 1) < BLEND_PARSER_VERSION) j.info = { ...emptySceneInfo() }
    }
    for (const j of this.jobs) if (j.info.state === 'pending') this.enqueueProbe(j.id, false)
    this.refresh()
  }

  private restoreJob(j: Job): Job {
    const job: Job = { ...this.blankJob(j.scenePath), ...j }
    job.app = appOf(j.scenePath)
    const legacy = j.info as SceneInfo & { mayaVersion?: string | null }
    job.info = { ...emptySceneInfo(), ...j.info, version: j.info.version ?? legacy.mayaVersion ?? null }
    delete (job.info as SceneInfo & { mayaVersion?: string | null }).mayaVersion
    delete (job as Job & { mayaUsed?: string | null }).mayaUsed
    job.dismissed = j.dismissed ?? []
    if (job.info.state === 'running') job.info.state = 'pending'
    if (job.status === 'rendering') {
      job.status = 'stopped'
      job.runMode = 'missing'
    }
    job.tasks = (job.tasks ?? []).map((t) =>
      t.status === 'running' || t.status === 'pending' ? { ...t, status: 'stopped', pid: null } : t
    )
    return job
  }

  private blankJob(scenePath: string): Job {
    return {
      id: uid('j'),
      scenePath,
      sceneName: sceneNameOf(scenePath),
      app: appOf(scenePath),
      enabled: true,
      status: 'idle',
      runMode: 'full',
      overwrite: true,
      overrides: {},
      info: emptySceneInfo(),
      project: findProjectDir(scenePath),
      frames: [],
      doneFrames: [],
      missingFrames: [],
      tasks: [],
      outputDir: null,
      outputExample: null,
      versionUsed: null,
      issues: [],
      dismissed: [],
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      elapsedMs: 0,
      avgFrameMs: null,
      etaMs: null,
      lastFrame: null,
      previewVideo: null
    }
  }

  snapshot(): Snapshot {
    return {
      jobs: this.jobs,
      running: this.running,
      paused: this.paused,
      global: this.global,
      app: this.app,
      presets: this.presets,
      installs: this.installs,
      stats: this.stats(),
      completion: this.completion,
      runStartedAt: this.runStartedAt,
      awake: this.running && this.app.keepAwake,
      lock: { enabled: !!this.app.lockPinHash, locked: this.isLocked() }
    }
  }

  getLog(jobId: string | null): LogLine[] {
    return this.logs.get(jobId ?? SYSTEM_LOG) ?? []
  }

  private changed(save = true): void {
    if (save) this.scheduleSave()
    this.emit('change')
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 400)
  }

  saveNow(): void {
    try {
      const data: PersistShape = { version: 1, jobs: this.jobs, global: this.global, app: this.app, presets: this.presets }
      writeJsonAtomic(this.stateFile, data)
    } catch (e) {
      this.syslog('error', `Could not save state: ${(e as Error).message}`)
    }
  }

  private pushLog(line: LogLine): void {
    const key = line.jobId ?? SYSTEM_LOG
    let arr = this.logs.get(key)
    if (!arr) {
      arr = []
      this.logs.set(key, arr)
    }
    arr.push(line)
    if (arr.length > LOG_CAP) arr.splice(0, arr.length - LOG_CAP)
    this.pendingLog.push(line)
    if (!this.logTimer) {
      this.logTimer = setTimeout(() => {
        this.logTimer = null
        const lines = this.pendingLog
        this.pendingLog = []
        if (lines.length) this.emit('log', lines)
      }, 120)
    }
  }

  syslog(level: LogLevel, text: string): void {
    this.pushLog({ t: Date.now(), level, text, jobId: null, taskId: null })
  }

  private jlog(
    job: Job,
    task: Task | null,
    level: LogLevel,
    text: string,
    ctx?: TaskCtx,
    opts: { raw?: boolean; mirror?: boolean } = {}
  ): void {
    const line: LogLine = { t: Date.now(), level, text, jobId: job.id, taskId: task?.id ?? null, ...(opts.raw ? { raw: true } : {}) }
    this.pushLog(line)
    if (ctx?.stream) ctx.stream.write(`[${new Date(line.t).toISOString()}] ${level.toUpperCase().padEnd(8)} ${text}\n`)
    if (opts.raw) return
    const mirror = opts.mirror ?? (level === 'error' || (level === 'system' && !ctx))
    if (mirror) this.pushLog({ ...line, jobId: null, text: `${job.sceneName}: ${text}` })
  }

  addPaths(paths: string[]): { added: number; skipped: number } {
    const files: string[] = []
    const walk = (p: string, depth: number) => {
      let st: fs.Stats
      try {
        st = fs.statSync(p)
      } catch {
        return
      }
      if (st.isDirectory()) {
        if (depth > 6) return
        const base = path.basename(p).toLowerCase()
        if (base === 'incrementalsave' || base.startsWith('.')) return
        let entries: string[] = []
        try {
          entries = fs.readdirSync(p)
        } catch {
          return
        }
        entries.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        for (const e of entries) walk(path.join(p, e), depth + 1)
      } else if (isSceneFile(p)) files.push(path.resolve(p))
    }
    for (const p of paths) walk(p, 0)
    let added = 0
    let skipped = 0
    for (const f of files) {
      if (this.jobs.some((j) => j.scenePath === f && (j.status === 'idle' || j.status === 'rendering'))) {
        skipped++
        continue
      }
      const job = this.blankJob(f)
      this.jobs.push(job)
      if (this.running) this.runSet.add(job.id)
      this.enqueueProbe(job.id, false)
      added++
    }
    if (added) this.syslog('system', `Added ${added} scenes${skipped ? `; skipped ${skipped} duplicates` : ''}`)
    this.refresh()
    if (this.running) this.schedule()
    return { added, skipped }
  }

  removeJobs(ids: string[]): void {
    const set = new Set(ids)
    this.jobs = this.jobs.filter((j) => !set.has(j.id) || j.status === 'rendering')
    for (const id of ids) {
      this.runSet.delete(id)
      this.logs.delete(id)
    }
    this.refresh()
  }

  reorderJobs(ids: string[]): void {
    const map = new Map(this.jobs.map((j) => [j.id, j]))
    const next: Job[] = []
    for (const id of ids) {
      const j = map.get(id)
      if (j) {
        next.push(j)
        map.delete(id)
      }
    }
    for (const j of map.values()) next.push(j)
    this.jobs = next
    this.changed()
  }

  moveJobs(ids: string[], where: 'top' | 'bottom'): void {
    const set = new Set(ids)
    const moving = this.jobs.filter((j) => set.has(j.id))
    const rest = this.jobs.filter((j) => !set.has(j.id))
    this.jobs = where === 'top' ? [...moving, ...rest] : [...rest, ...moving]
    this.changed()
  }

  duplicateJobs(ids: string[]): void {
    const set = new Set(ids)
    const next: Job[] = []
    for (const j of this.jobs) {
      next.push(j)
      if (set.has(j.id)) {
        const copy = this.blankJob(j.scenePath)
        copy.overrides = { ...j.overrides }
        copy.info = JSON.parse(JSON.stringify(j.info))
        copy.project = j.project
        next.push(copy)
        if (this.running) this.runSet.add(copy.id)
      }
    }
    this.jobs = next
    this.refresh()
  }

  updateJobs(ids: string[], patch: JobPatch): void {
    const set = new Set(ids)
    for (const j of this.jobs) {
      if (!set.has(j.id) || j.status === 'rendering') continue
      if (patch.enabled !== undefined) j.enabled = patch.enabled
      if (patch.overrides) Object.assign(j.overrides, this.allowedOverrides(sanitizeRender(patch.overrides)))
      if (patch.clear) for (const k of patch.clear) if (!this.isLocked() || STUDENT_KEYS.has(k)) delete j.overrides[k]
      if (patch.dismiss) j.dismissed = [...new Set([...(j.dismissed ?? []), ...patch.dismiss])]
      if (patch.enabled && this.running && (j.status === 'idle' || j.status === 'stopped')) this.runSet.add(j.id)
    }
    this.refresh()
    if (this.running) this.schedule()
  }

  resetJobs(ids: string[], mode: 'full' | 'missing'): void {
    const set = new Set(ids)
    for (const j of this.jobs) {
      if (!set.has(j.id) || j.status === 'rendering') continue
      j.status = 'idle'
      j.runMode = mode
      j.error = null
      j.tasks = []
      j.missingFrames = []
      j.finishedAt = null
      if (mode === 'full') {
        j.doneFrames = []
        j.lastFrame = null
        j.previewVideo = null
      }
      j.enabled = true
      if (this.running) this.runSet.add(j.id)
    }
    this.refresh()
    if (this.running) this.schedule()
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.status !== 'done' && j.status !== 'skipped')
    this.refresh()
  }

  updateGlobal(patch: Partial<RenderSettings>): void {
    if (this.isLocked()) {
      this.syslog('warn', 'Settings are locked; output defaults cannot be changed')
      this.changed(false)
      return
    }
    Object.assign(this.global, sanitizeRender(patch))
    this.refresh()
  }

  isLocked(): boolean {
    return !!this.app.lockPinHash && !this.sessionUnlocked
  }

  private allowedOverrides(o: Partial<RenderSettings>): Partial<RenderSettings> {
    if (!this.isLocked()) return o
    const out: Partial<RenderSettings> = {}
    for (const [k, v] of Object.entries(o)) if (STUDENT_KEYS.has(k as keyof RenderSettings)) (out as Record<string, unknown>)[k] = v
    return out
  }

  unlock(pin: string): boolean {
    if (!this.app.lockPinHash) return true
    if (hashPin(pin) !== this.app.lockPinHash) return false
    this.sessionUnlocked = true
    this.syslog('system', 'Settings unlocked')
    this.changed(false)
    return true
  }

  lockNow(): void {
    if (!this.app.lockPinHash) return
    this.sessionUnlocked = false
    this.syslog('system', 'Settings locked')
    this.changed(false)
  }

  setPin(pin: string | null): boolean {
    if (this.isLocked()) return false
    this.app.lockPinHash = pin ? hashPin(pin) : ''
    this.sessionUnlocked = !!pin
    this.syslog('system', pin ? 'Settings PIN configured' : 'Settings unlocked; PIN removed')
    this.changed()
    return true
  }

  updateApp(patch: Partial<AppSettings>): void {
    const raw: Partial<AppSettings> = { ...patch }
    delete raw.lockPinHash
    if (this.isLocked()) for (const k of Object.keys(raw) as (keyof AppSettings)[]) if (!STUDENT_APP_KEYS.has(k)) delete raw[k]
    const clean = sanitizeApp(raw)
    const encChanged = clean.logEncoding !== undefined && clean.logEncoding !== this.app.logEncoding
    Object.assign(this.app, clean)
    if (clean.completionAction !== undefined) this.completion.action = clean.completionAction
    if (clean.manualInstalls !== undefined) this.installs = this.discoverInstalls(this.app.manualInstalls)
    if (encChanged) void detectConsoleEncoding(this.app.logEncoding).then((e) => (this.encoding = e))
    if (clean.concurrency !== undefined && this.running) this.schedule()
    this.refresh()
  }

  setCompletion(action: CompletionAction): void {
    this.updateApp({ completionAction: action })
  }

  savePreset(name: string): Preset | null {
    if (this.isLocked()) return null
    const existing = this.presets.find((p) => p.name === name)
    if (existing) {
      existing.settings = { ...this.global }
      this.changed()
      return existing
    }
    const p: Preset = { id: uid('p'), name, settings: { ...this.global } }
    this.presets.push(p)
    this.changed()
    return p
  }

  applyPreset(id: string): void {
    if (this.isLocked()) return
    const p = this.presets.find((x) => x.id === id)
    if (!p) return
    this.global = { ...DEFAULT_RENDER, ...p.settings }
    this.syslog('system', `Preset applied: ${p.name}`)
    this.refresh()
  }

  deletePreset(id: string): void {
    this.presets = this.presets.filter((p) => p.id !== id)
    this.changed()
  }

  private installSummary(): string {
    const n = (app: AppKind) => this.installs.filter((i) => i.app === app).length
    return `${n('maya')} Maya and ${n('blender')} Blender installations found`
  }

  detectApps(): void {
    this.installs = this.discoverInstalls(this.app.manualInstalls)
    this.syslog('system', `Application scan: ${this.installSummary()}`)
    this.refresh()
  }

  addInstall(p: string): void {
    if (this.isLocked()) return
    if (!this.app.manualInstalls.includes(p)) this.app.manualInstalls = [...this.app.manualInstalls, p]
    this.detectApps()
  }

  removeInstall(id: string): void {
    if (this.isLocked()) return
    const inst = this.installs.find((i) => i.id === id)
    if (!inst) return
    this.app.manualInstalls = this.app.manualInstalls.filter(
      (m) => installPathKey(manualInstall(m)?.renderPath ?? m) !== installPathKey(inst.renderPath)
    )
    this.detectApps()
  }

  private pick(job: Job, s: RenderSettings = effectiveSettings(this.global, job)) {
    return chooseInstall(this.installs, job.app, job.app === 'blender' ? s.blenderVersion : s.mayaVersion, job.info.version)
  }

  reprobe(ids: string[], deep: boolean): void {
    for (const id of ids) {
      const j = this.jobs.find((x) => x.id === id)
      if (!j || j.status === 'rendering') continue
      if (!deep) j.info = { ...emptySceneInfo() }
      this.enqueueProbe(id, deep)
    }
    this.changed()
  }

  private enqueueProbe(id: string, deep: boolean): void {
    if (this.probeQueue.some((q) => q.id === id && q.deep === deep)) return
    this.probeQueue.push({ id, deep })
    setImmediate(() => this.pumpProbe())
  }

  private pumpProbe(): void {
    if (this.disposed) return
    while (this.probeQueue.length) {
      const idx = this.probeQueue.findIndex((q) => (q.deep ? !this.deepActive : this.probeActive < 3))
      if (idx < 0) return
      const item = this.probeQueue.splice(idx, 1)[0]
      const job = this.jobs.find((j) => j.id === item.id)
      if (!job) continue
      if (item.deep) {
        this.deepActive = true
        void this.runDeepProbe(job).finally(() => {
          this.deepActive = false
          this.pumpProbe()
        })
      } else {
        this.probeActive++
        void this.runQuickProbe(job).finally(() => {
          this.probeActive--
          this.pumpProbe()
        })
      }
    }
  }

  private async runQuickProbe(job: Job): Promise<void> {
    job.info = { ...emptySceneInfo(), state: 'running' }
    this.changed(false)
    let info: SceneInfo
    try {
      if (!fs.existsSync(job.scenePath)) throw new Error('Scene file not found')
      if (job.app === 'blender') {
        info = await this.probeBlenderScene(job)
      } else {
        info = /\.ma$/i.test(job.scenePath) ? await probeAscii(job.scenePath) : await probeBinary(job.scenePath)
        job.project = findProjectDir(job.scenePath)
        if (info.references.length)
          info.references = resolveRefs(
            info.references.map((r) => r.path),
            job.scenePath,
            job.project
          )
      }
    } catch (e) {
      info = { ...emptySceneInfo(), state: 'error', error: (e as Error).message }
    }
    if (!this.jobs.includes(job)) return
    job.info = info
    this.refresh()
    if (this.running) this.schedule()
    if (info.state === 'done' && this.app.deepProbe && /\.mb$/i.test(job.scenePath)) {
      const choice = this.pick(job)
      if (choice.install?.mayapyPath) this.enqueueProbe(job.id, true)
    }
  }

  private async probeBlenderScene(job: Job): Promise<SceneInfo> {
    job.project = null
    try {
      return await probeBlend(job.scenePath)
    } catch (e) {
      const blender = this.pick(job).install
      if (!blender) throw e
      this.jlog(job, null, 'system', `File inspection failed; inspecting with Blender ${blender.version}: ${(e as Error).message}`)
      return probeBlenderDeep(blender.renderPath, job.scenePath, path.join(this.dataDir, 'blender_probe.py'), 240000)
    }
  }

  private async runDeepProbe(job: Job): Promise<void> {
    if (job.app === 'blender') return
    const choice = this.pick(job)
    const mayapy = choice.install?.mayapyPath
    if (!mayapy) {
      this.jlog(job, null, 'warn', 'Detailed inspection requires mayapy')
      return
    }
    this.jlog(job, null, 'system', `Detailed inspection started (mayapy ${choice.install?.version})`)
    try {
      const d = await probeDeep(job.scenePath, { mayapy, scriptPath: path.join(this.dataDir, 'probe.py'), timeoutMs: 240000 })
      if (!this.jobs.includes(job)) return
      const merged: SceneInfo = { ...job.info }
      for (const [k, v] of Object.entries(d)) {
        if (k === 'refsRaw') continue
        if (v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0 && k !== 'cameras' && k !== 'layers'))
          (merged as unknown as Record<string, unknown>)[k] = v
      }
      if (d.refsRaw) merged.references = resolveRefs(d.refsRaw, job.scenePath, job.project)
      merged.state = 'done'
      merged.error = null
      job.info = merged
      this.jlog(job, null, 'system', 'Detailed inspection complete')
    } catch (e) {
      this.jlog(job, null, 'warn', `Detailed inspection failed: ${(e as Error).message}`)
    }
    this.refresh()
  }

  resolveFrames(job: Job, s: RenderSettings): number[] {
    const i = job.info
    if (s.frameMode === 'custom') return frameList(s.start, s.end, s.step)
    if (s.frameMode === 'timeline' && i.timelineStart !== null && i.timelineEnd !== null)
      return frameList(i.timelineStart, i.timelineEnd, 1)
    if (i.start !== null && i.end !== null) return frameList(i.start, i.end, i.step ?? 1)
    return []
  }

  private frameStep(job: Job, s: RenderSettings): number {
    if (s.frameMode === 'custom') return Math.max(1, s.step)
    if (s.frameMode === 'timeline') return 1
    return Math.max(1, Math.round(job.info.step ?? 1))
  }

  refresh(): void {
    const keyCount = new Map<string, number>()
    const keyOf = (j: Job, s: RenderSettings) => `${resolvedOutputDir(s, j).toLowerCase()}|${resolvedPrefix(s, j).toLowerCase()}`
    for (const j of this.jobs) {
      if (!j.enabled || j.status === 'done' || j.status === 'skipped') continue
      const s = effectiveSettings(this.global, j)
      if (!s.outputRoot) continue
      const k = keyOf(j, s)
      keyCount.set(k, (keyCount.get(k) ?? 0) + 1)
    }
    for (const j of this.jobs) {
      const s = effectiveSettings(this.global, j)
      if (j.status !== 'rendering') {
        j.frames = j.info.state === 'done' ? this.resolveFrames(j, s) : j.frames
        if (s.outputRoot) {
          j.outputDir = resolvedOutputDir(s, j)
          const first = j.frames[0] ?? 1
          j.outputExample = path.join(j.outputDir, `${resolvedPrefix(s, j)}.${String(first).padStart(s.padding, '0')}.${expectedExt(s, j)}`)
        } else {
          j.outputDir = null
          j.outputExample = null
        }
      }
      j.issues = computeIssues(j, s, this.installs, (keyCount.get(keyOf(j, s)) ?? 0) > 1)
    }
    this.changed()
  }

  stats(): QueueStats {
    let total = 0
    let done = 0
    let eta = 0
    let etaKnown = true
    let jobsTotal = 0
    let jobsDone = 0
    let jobsFailed = 0
    let estimated = false
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
    const frameAvg = mean(this.jobs.map((j) => j.avgFrameMs).filter((x): x is number => !!x))
    const loadAvg = mean(this.jobs.map((j) => j.loadMs).filter((x): x is number => x != null))
    const now = Date.now()
    const runningCtx = new Map<string, TaskCtx[]>()
    for (const c of this.ctxs.values()) runningCtx.set(c.job.id, [...(runningCtx.get(c.job.id) ?? []), c])
    for (const j of this.jobs) {
      if (!j.enabled || j.status === 'skipped') continue
      jobsTotal++
      if (j.status === 'done') jobsDone++
      if (j.status === 'failed' || j.status === 'partial') jobsFailed++
      total += j.frames.length
      done += Math.min(j.doneFrames.length, j.frames.length)
      const remaining = Math.max(0, j.frames.length - j.doneFrames.length)
      const queued = this.running ? this.runSet.has(j.id) || j.status === 'rendering' : j.status === 'idle' || j.status === 'stopped'
      j.etaMs = null
      if (!queued || !remaining) continue
      const frameMs = j.avgFrameMs ?? frameAvg
      const loadMs = j.loadMs ?? loadAvg ?? 0
      if (!frameMs) {
        etaKnown = false
        continue
      }
      if (!j.avgFrameMs) estimated = true
      const s = effectiveSettings(this.global, j)
      const ctxs = runningCtx.get(j.id) ?? []
      const pendingSessions =
        j.status === 'rendering'
          ? j.tasks.filter((t) => t.status === 'pending').length
          : s.chunkSize > 0
            ? Math.ceil(remaining / s.chunkSize)
            : 1
      const loading = ctxs.reduce(
        (a, c) => a + (c.loadEnd === null && c.task.startedAt ? Math.max(0, loadMs - (now - c.task.startedAt)) : 0),
        0
      )
      const gap = this.licenseGapMs * pendingSessions
      const jobEta = remaining * frameMs + pendingSessions * loadMs + loading + gap
      j.etaMs = jobEta / Math.max(1, ctxs.length)
      eta += jobEta
    }
    return {
      totalFrames: total,
      doneFrames: done,
      progress: total ? done / total : 0,
      elapsedMs: this.runStartedAt ? now - this.runStartedAt : 0,
      etaMs: etaKnown && eta > 0 ? eta / Math.max(1, this.app.concurrency) : null,
      etaEstimated: estimated,
      runningTasks: this.ctxs.size,
      jobsTotal,
      jobsDone,
      jobsFailed
    }
  }

  start(): void {
    if (this.completion.countdown !== null) this.cancelCountdown()
    if (this.running) {
      if (this.paused) this.resume()
      return
    }
    this.runSet = new Set(this.jobs.filter((j) => j.enabled && (j.status === 'idle' || j.status === 'stopped')).map((j) => j.id))
    if (!this.runSet.size) {
      this.syslog('warn', 'No jobs to render')
      this.changed(false)
      return
    }
    this.running = true
    this.paused = false
    this.stopRequested = false
    this.runHadFailure = false
    this.runTasksStarted = 0
    this.licenseGapMs = 0
    this.gapNotedUntil = 0
    this.runStartedAt = Date.now()
    this.syslog('system', `Render started: ${this.runSet.size} jobs, ${this.app.concurrency} concurrent tasks`)
    this.emit('awake', this.app.keepAwake)
    this.startWatch()
    this.schedule()
    this.changed()
  }

  pause(): void {
    if (!this.running || this.paused) return
    this.paused = true
    this.syslog('system', 'Pausing after active scenes finish')
    this.changed(false)
  }

  resume(): void {
    if (!this.running || !this.paused) return
    this.paused = false
    this.syslog('system', 'Rendering resumed')
    this.schedule()
    this.changed(false)
  }

  stop(): void {
    if (!this.running) return
    this.stopRequested = true
    this.running = false
    this.paused = false
    this.syslog('system', 'Render stop requested')
    for (const ctx of this.ctxs.values()) ctx.proc.kill()
    for (const j of this.jobs) {
      if (j.status !== 'rendering') continue
      for (const t of j.tasks) if (t.status === 'pending') t.status = 'stopped'
      if (!j.tasks.some((t) => t.status === 'running')) this.finalizeJob(j)
    }
    this.runSet.clear()
    if (!this.ctxs.size) this.endRun()
    this.changed()
  }

  skip(ids: string[]): void {
    const set = new Set(ids)
    for (const j of this.jobs) {
      if (!set.has(j.id)) continue
      if (j.status === 'rendering') {
        j.status = 'skipped'
        for (const t of j.tasks) if (t.status === 'pending') t.status = 'stopped'
        for (const ctx of this.ctxs.values()) if (ctx.job === j) ctx.proc.kill()
        if (!j.tasks.some((t) => t.status === 'running')) this.finalizeJob(j)
        this.jlog(j, null, 'system', 'Job skipped')
      } else if (j.status === 'idle' || j.status === 'stopped') {
        j.status = 'skipped'
        this.runSet.delete(j.id)
      }
    }
    this.changed()
    if (this.running) this.schedule()
  }

  private runningCount(): number {
    return this.ctxs.size
  }

  private schedule(): void {
    if (!this.running) return
    if (!this.paused) {
      let guard = 0
      while (this.runningCount() < this.app.concurrency && guard++ < 1000) {
        const next = this.nextTask()
        if (!next) break
        if (this.licenseGapMs && this.ctxs.size) break
        const wait = this.licenseGapMs ? this.lastSessionEndAt + this.licenseGapMs - Date.now() : 0
        if (wait > 0) {
          this.armRetryTimer(Date.now() + wait)
          if (this.gapNotedUntil < this.lastSessionEndAt + this.licenseGapMs) {
            this.gapNotedUntil = this.lastSessionEndAt + this.licenseGapMs
            this.jlog(
              next.job,
              null,
              'system',
              `Waiting for Arnold license release; rendering resumes in ${Math.ceil(wait / 1000)} seconds`
            )
          }
          break
        }
        this.startTask(next.job, next.task)
      }
    }
    if (this.runningCount() === 0 && !this.paused) {
      const left = this.jobs.some(
        (j) => j.enabled && (j.status === 'rendering' || (this.runSet.has(j.id) && (j.status === 'idle' || j.status === 'stopped')))
      )
      const waitingProbe = this.jobs.some((j) => this.runSet.has(j.id) && (j.info.state === 'pending' || j.info.state === 'running'))
      if (!left || (!waitingProbe && !this.nextTaskAvailable())) this.finishRun()
    }
    this.emitProgress()
  }

  private armRetryTimer(at: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = null
        this.schedule()
        this.changed()
      },
      Math.max(0, at - Date.now()) + 50
    )
  }

  private nextTaskAvailable(): boolean {
    return this.jobs.some((j) => j.enabled && j.status === 'rendering' && j.tasks.some((t) => t.status === 'pending'))
  }

  private nextTask(): { job: Job; task: Task } | null {
    for (const job of this.jobs) {
      if (!job.enabled) continue
      if (job.status === 'rendering') {
        const pending = job.tasks.filter((x) => x.status === 'pending')
        const t = pending.find((x) => !x.notBefore || x.notBefore <= Date.now())
        if (t) return { job, task: t }
        if (pending.length) {
          this.armRetryTimer(Math.min(...pending.map((x) => x.notBefore ?? Date.now())))
          return null
        }
        continue
      }
      if (!this.runSet.has(job.id) || (job.status !== 'idle' && job.status !== 'stopped')) continue
      if (job.info.state === 'pending' || job.info.state === 'running') continue
      if (this.planJob(job)) {
        const t = job.tasks.find((x) => x.status === 'pending')
        if (t) return { job, task: t }
      }
    }
    return null
  }

  private planJob(job: Job): boolean {
    const s = effectiveSettings(this.global, job)
    this.refresh()
    const blocking = job.issues.find((i) => i.level === 'error')
    if (blocking) {
      job.status = 'failed'
      job.error = blocking.message
      job.finishedAt = Date.now()
      this.runSet.delete(job.id)
      this.runHadFailure = true
      this.jlog(job, null, 'error', `Cannot render: ${blocking.message}`)
      this.emit('notify', { title: 'Cannot render', body: `${job.sceneName}: ${blocking.message}`, level: 'error' })
      return false
    }
    const outputDir = resolvedOutputDir(s, job)
    try {
      fs.mkdirSync(outputDir, { recursive: true })
    } catch (e) {
      job.status = 'failed'
      job.error = `Could not create output folder: ${(e as Error).message}`
      this.runSet.delete(job.id)
      this.runHadFailure = true
      this.jlog(job, null, 'error', job.error)
      return false
    }
    const all = this.resolveFrames(job, s)
    const step = this.frameStep(job, s)
    const done = new Set<number>(job.runMode === 'missing' ? job.doneFrames : [])
    if (s.skipExisting || job.runMode === 'missing') {
      const present = framesPresent(scanFrames(outputDir, prefixHint(resolvedPrefix(s, job))))
      for (const f of all) if (present.has(f)) done.add(f)
    }
    job.frames = all
    job.doneFrames = all.filter((f) => done.has(f))
    job.missingFrames = []
    job.outputDir = outputDir
    job.error = null
    job.startedAt = Date.now()
    job.finishedAt = null
    job.etaMs = null
    this.frameTimes.set(job.id, [])
    const todo = all.filter((f) => !done.has(f))
    job.tasks = toRanges(todo, step, s.chunkSize).map((r) => this.newTask(r.start, r.end, r.step, 0))
    job.status = 'rendering'
    job.runMode = 'missing'
    const choice = this.pick(job, s)
    job.versionUsed = choice.install?.version ?? null
    const skippedNote = job.doneFrames.length ? `; skipping ${job.doneFrames.length} existing frames` : ''
    this.jlog(job, null, 'system', `Job started: ${all.length} frames${skippedNote}; output: ${outputDir}`)
    if (!todo.length) {
      this.finalizeJob(job)
      return false
    }
    this.changed()
    return true
  }

  private newTask(start: number, end: number, step: number, attempt: number): Task {
    return {
      id: uid('t'),
      start,
      end,
      step,
      status: 'pending',
      attempt,
      pid: null,
      startedAt: null,
      finishedAt: null,
      exitCode: null,
      logPath: null,
      error: null,
      currentFrame: null,
      percent: 0
    }
  }

  private threadsFor(): number {
    if (this.app.threadsPerTask > 0) return this.app.threadsPerTask
    if (this.app.concurrency > 1) return Math.max(1, Math.floor(this.cores / this.app.concurrency))
    return 0
  }

  private startTask(job: Job, task: Task): void {
    const s = effectiveSettings(this.global, job)
    const choice = this.pick(job, s)
    task.status = 'running'
    task.startedAt = Date.now()
    task.finishedAt = null
    task.percent = 0
    task.currentFrame = task.start
    task.error = null
    this.runTasksStarted++
    if (!choice.install) {
      task.status = 'failed'
      task.error = `${APP_LABEL[job.app]} installation not found`
      this.jlog(job, task, 'error', task.error)
      this.afterTask(job)
      return
    }
    const taskDir = path.join(this.dataDir, 'tasks', task.id)
    const logDir = path.join(this.dataDir, 'logs', job.id)
    let cmd: ReturnType<typeof buildCommand>
    try {
      fs.mkdirSync(logDir, { recursive: true })
      cmd = buildCommand({
        job,
        task,
        settings: s,
        install: choice.install,
        taskDir,
        threads: this.threadsFor(),
        arnoldVerbosity: this.app.arnoldVerbosity
      })
    } catch (e) {
      task.status = 'failed'
      task.error = `Could not build render command: ${(e as Error).message}`
      this.jlog(job, task, 'error', task.error)
      this.afterTask(job)
      return
    }
    task.logPath = path.join(logDir, `${task.id}.log`)
    const stream = fs.createWriteStream(task.logPath, { flags: 'a' })
    const proc = new RenderProcess(cmd.exe, cmd.args, cmd.env, path.dirname(job.scenePath), job.app === 'blender' ? 'utf8' : this.encoding)
    const ctx: TaskCtx = {
      job,
      task,
      proc,
      stream,
      outputDir: cmd.outputDir,
      hint: prefixHint(cmd.prefix),
      since: Date.now() - 2000,
      written: new Set(),
      confirmed: new Set(),
      lastConfirmAt: Date.now(),
      expected: rangeFrames(task),
      errors: 0,
      licenseFail: false,
      loadEnd: null,
      firstDt: null
    }
    this.ctxs.set(task.id, ctx)
    const range = task.start === task.end ? `${task.start}` : `${task.start}-${task.end}`
    this.jlog(
      job,
      task,
      'system',
      `Render process started: frames ${range}${task.attempt ? `; retry ${task.attempt}` : ''}; ${APP_LABEL[job.app]} ${choice.install.version}; renderer: ${cmd.renderer}`,
      ctx
    )
    this.jlog(job, task, 'info', `Command: ${quoteArg(cmd.exe)} ${cmd.args.map(quoteArg).join(' ')}`, ctx)
    proc.on('event', (e: RunnerEvent) => this.onRunnerEvent(ctx, e))
    proc.once('exit', (code: number | null, signal: string | null) => this.onTaskExit(ctx, code, signal))
    task.pid = proc.start()
    this.changed()
  }

  private onRunnerEvent(ctx: TaskCtx, e: RunnerEvent): void {
    const { job, task } = ctx
    switch (e.type) {
      case 'line':
        if (e.level === 'error') ctx.errors++
        if (!ctx.licenseFail && LICENSE_FAIL_RE.test(e.text)) {
          ctx.licenseFail = true
          this.jlog(job, task, 'system', 'Could not acquire an Arnold license', ctx)
        }
        this.jlog(job, task, e.level, e.text, ctx, { raw: e.level !== 'progress' })
        if (e.level === 'progress') this.emit('change')
        break
      case 'frameStart':
        if (ctx.loadEnd === null) {
          ctx.loadEnd = Date.now()
          ctx.lastConfirmAt = ctx.loadEnd
          if (task.startedAt) this.recordLoad(job, ctx.loadEnd - task.startedAt)
        }
        task.currentFrame = e.frame
        task.percent = 0
        this.emit('change')
        break
      case 'frameEnd':
        this.confirmFrame(ctx, e.frame)
        break
      case 'percent':
        task.percent = e.percent
        break
      case 'boot':
        this.jlog(job, task, 'system', `${APP_LABEL[job.app]} render session started (${e.version})`, ctx)
        break
      case 'device': {
        const [kind, ...names] = e.text.split(' ')
        this.jlog(
          job,
          task,
          'system',
          kind === 'CPU' ? 'Render device: CPU' : `Render device: GPU ${kind}${names.length ? ` (${names.join(' ')})` : ''}`,
          ctx
        )
        break
      }
    }
  }

  private confirmFrame(ctx: TaskCtx, frame: number): void {
    const { job, task } = ctx
    if (!ctx.expected.includes(frame) || ctx.confirmed.has(frame)) return
    ctx.confirmed.add(frame)
    if (!job.doneFrames.includes(frame)) job.doneFrames.push(frame)
    const now = Date.now()
    const dt = now - ctx.lastConfirmAt
    ctx.lastConfirmAt = now
    const first = ctx.confirmed.size === 1
    if (first && ctx.loadEnd === null) {
      ctx.firstDt = dt
    } else {
      if (ctx.firstDt !== null) {
        this.recordLoad(job, Math.max(0, ctx.firstDt - dt))
        ctx.firstDt = null
      }
      const times = this.frameTimes.get(job.id) ?? []
      times.push(dt)
      if (times.length > 30) times.shift()
      this.frameTimes.set(job.id, times)
      job.avgFrameMs = times.reduce((a, b) => a + b, 0) / times.length
    }
    const next = ctx.expected.find((f) => !ctx.confirmed.has(f))
    task.currentFrame = next ?? frame
    task.percent = 0
    this.changed()
  }

  private recordLoad(job: Job, ms: number): void {
    job.loadMs = job.loadMs == null ? ms : job.loadMs * 0.5 + ms * 0.5
  }

  private startWatch(): void {
    if (this.watchTimer) return
    this.watchTimer = setInterval(() => this.watchTick(), 1500)
  }

  private stopWatch(): void {
    if (this.watchTimer) clearInterval(this.watchTimer)
    this.watchTimer = null
  }

  private watchTick(): void {
    const cache = new Map<string, FrameFile[]>()
    for (const ctx of this.ctxs.values()) this.scanCtx(ctx, cache, false)
    if (this.ctxs.size) this.emit('change')
    this.emitProgress()
  }

  private scanCtx(ctx: TaskCtx, cache: Map<string, FrameFile[]>, final: boolean): void {
    const key = `${ctx.outputDir}|${ctx.hint}`
    let files = cache.get(key)
    if (!files) {
      files = scanFrames(ctx.outputDir, ctx.hint)
      cache.set(key, files)
    }
    const fresh = framesPresent(files, ctx.since)
    let latest: FrameFile | null = null
    for (const f of ctx.expected) {
      const hit = fresh.get(f)
      if (!hit) continue
      ctx.written.add(f)
      if (!latest || hit.mtimeMs > latest.mtimeMs) latest = hit
    }
    if (latest) ctx.job.lastFrame = { frame: latest.frame, path: latest.path }
    const written = [...ctx.written].sort((a, b) => a - b)
    const max = written[written.length - 1]
    for (const f of written) if (final || f < max) this.confirmFrame(ctx, f)
    if (!final && max !== undefined && ctx.task.currentFrame !== null && ctx.task.currentFrame <= max) {
      const next = ctx.expected.find((f) => f > max)
      if (next !== undefined && !ctx.confirmed.has(next)) ctx.task.currentFrame = next
    }
  }

  private onTaskExit(ctx: TaskCtx, code: number | null, signal: string | null): void {
    const { job, task, proc } = ctx
    this.ctxs.delete(task.id)
    task.finishedAt = Date.now()
    this.lastSessionEndAt = task.finishedAt
    if (ctx.licenseFail && !proc.killed) {
      const base = this.retryDelays.license
      const next = this.licenseGapMs ? Math.min(this.licenseGapMs * 2, base * 3) : base
      if (next !== this.licenseGapMs) {
        this.licenseGapMs = next
        this.syslog('system', `Waiting ${Math.round(next / 1000)} seconds between renders for Arnold license release`)
      }
    }
    task.exitCode = code
    task.pid = null
    const killed = proc.killed
    this.scanCtx(ctx, new Map(), !killed)
    if (!killed) this.verifyOnDisk(ctx)
    const doneSet = new Set(job.doneFrames)
    const missing = ctx.expected.filter((f) => !doneSet.has(f))
    if (killed) {
      task.status = 'stopped'
      this.jlog(job, task, 'system', `Render process stopped by user; ${ctx.confirmed.size} frames complete`, ctx)
    } else if (!missing.length) {
      task.status = 'done'
      task.percent = 100
      if (code !== 0) this.jlog(job, task, 'warn', `Exit code ${code ?? signal}; all frame files verified, marking complete`, ctx)
      this.jlog(
        job,
        task,
        'system',
        `Render process complete: ${ctx.expected.length} frames in ${formatDuration(task.finishedAt - (task.startedAt ?? task.finishedAt))}`,
        ctx
      )
    } else {
      task.status = 'failed'
      const lic = ctx.licenseFail
      const licTries = task.licenseTries ?? 0
      task.error = lic
        ? 'Arnold license check failed'
        : code !== 0
          ? describeExit(code, signal, job.app === 'blender' ? 'Blender' : process.platform === 'win32' ? 'Render.exe' : 'Maya Render')
          : 'No frame files found'
      const live = this.running && !this.stopRequested && job.status === 'rendering'
      const canRetry = live && (lic ? licTries < LICENSE_TRIES : task.attempt < this.app.maxRetries)
      this.jlog(job, task, canRetry ? (lic ? 'system' : 'warn') : 'error', `${task.error}; missing frames: ${compactFrames(missing)}`, ctx)
      if (canRetry) {
        const delay = lic ? this.licenseGapMs : code !== 0 ? this.retryDelays.crash : this.retryDelays.missing
        const notBefore = Date.now() + delay
        const retries = toRanges(missing, task.step, 0).map((r) => ({
          ...this.newTask(r.start, r.end, r.step, lic ? task.attempt : task.attempt + 1),
          notBefore,
          licenseTries: lic ? licTries + 1 : licTries
        }))
        const idx = job.tasks.indexOf(task)
        job.tasks.splice(idx + 1, 0, ...retries)
        const note = lic
          ? `Queued missing frames ${compactFrames(missing)} for retry (license wait ${licTries + 1}/${LICENSE_TRIES})`
          : `Queued missing frames for retry (${task.attempt + 1}/${this.app.maxRetries}); starting in ${Math.round(delay / 1000)} seconds`
        this.jlog(job, task, 'system', note, ctx, { mirror: true })
      } else {
        this.runHadFailure = true
      }
    }
    ctx.stream?.end()
    ctx.stream = null
    try {
      fs.rmSync(path.join(this.dataDir, 'tasks', task.id), { recursive: true, force: true })
    } catch {
      undefined
    }
    this.afterTask(job)
  }

  private verifyOnDisk(ctx: TaskCtx): void {
    const { job, task } = ctx
    const fresh = framesPresent(scanFrames(ctx.outputDir, ctx.hint), ctx.since)
    const onDisk = ctx.expected.filter((f) => fresh.has(f))
    if (onDisk.length) {
      const gaps = ctx.expected.filter((f) => ctx.confirmed.has(f) && !fresh.has(f))
      if (!gaps.length) return
      for (const f of gaps) ctx.confirmed.delete(f)
      const gapSet = new Set(gaps)
      job.doneFrames = job.doneFrames.filter((f) => !gapSet.has(f))
      this.jlog(job, task, 'warn', `Render reported complete, but files are missing: ${compactFrames(gaps)}`, ctx)
    } else if (ctx.confirmed.size) {
      if (ctx.confirmed.size === ctx.expected.length && !ctx.errors && !ctx.licenseFail) {
        this.jlog(
          job,
          task,
          'warn',
          `Frame files were not found; using render completion signals. Check the output path: ${ctx.outputDir}`,
          ctx
        )
        return
      }
      const dropped = [...ctx.confirmed].sort((a, b) => a - b)
      const dropSet = new Set(dropped)
      ctx.confirmed.clear()
      job.doneFrames = job.doneFrames.filter((f) => !dropSet.has(f))
      this.jlog(job, task, 'warn', `Frames remain incomplete because output files are missing: ${compactFrames(dropped)}`, ctx)
    }
  }

  private afterTask(job: Job): void {
    if (this.disposed) return
    if (!job.tasks.some((t) => t.status === 'pending' || t.status === 'running')) this.finalizeJob(job)
    if (this.running) this.schedule()
    else if (!this.ctxs.size && this.stopRequested) this.endRun()
    this.changed()
  }

  private finalizeJob(job: Job): void {
    const doneSet = new Set(job.doneFrames)
    job.doneFrames = job.frames.filter((f) => doneSet.has(f))
    job.missingFrames = job.frames.filter((f) => !doneSet.has(f))
    job.finishedAt = Date.now()
    job.elapsedMs = job.startedAt ? job.finishedAt - job.startedAt : 0
    job.etaMs = null
    for (const t of job.tasks) {
      t.currentFrame = null
      if (t.status === 'running') t.status = 'stopped'
    }
    this.runSet.delete(job.id)
    if (job.status === 'skipped') {
      this.changed()
      return
    }
    const stopped = job.tasks.some((t) => t.status === 'stopped')
    if (!job.missingFrames.length) {
      job.status = 'done'
      job.error = null
      this.jlog(job, null, 'system', `Job complete: ${job.frames.length} frames in ${formatDuration(job.elapsedMs)}`)
      this.emit('notify', { title: 'Render complete', body: `${job.sceneName} (${job.frames.length} frames)`, level: 'info' })
      const s = effectiveSettings(this.global, job)
      if (s.makePreview) void this.makePreview(job, s)
    } else if (stopped) {
      job.status = 'stopped'
      job.runMode = 'missing'
      this.jlog(job, null, 'system', `Job stopped: ${job.missingFrames.length} frames remaining`)
    } else {
      job.status = job.doneFrames.length ? 'partial' : 'failed'
      const cause = [...job.tasks].reverse().find((t) => t.status === 'failed' && t.error)?.error
      job.error = `Missing frames: ${compactFrames(job.missingFrames)}${cause ? ` (${cause})` : ''}`
      this.runHadFailure = true
      this.jlog(job, null, 'error', `Job ${job.status === 'partial' ? 'finished with missing frames' : 'failed'}: ${job.error}`)
      this.emit('notify', {
        title: job.status === 'partial' ? 'Missing frames' : 'Render failed',
        body: `${job.sceneName}: ${job.error}`,
        level: 'error'
      })
    }
    this.changed()
  }

  private async makePreview(job: Job, s: RenderSettings): Promise<void> {
    const ffmpeg = findFfmpeg(this.app.ffmpegPath)
    if (!ffmpeg || !job.outputDir) {
      this.jlog(job, null, 'warn', 'Preview skipped: FFmpeg not found')
      return
    }
    const files = scanFrames(job.outputDir, prefixHint(resolvedPrefix(s, job)))
    const seq = primarySequence(files, prefixHint(resolvedPrefix(s, job)))
    if (!seq) return
    const out = path.join(job.outputDir, `${job.sceneName}_preview.mp4`)
    const fps = s.previewFps || job.info.fps || 24
    this.jlog(job, null, 'system', `Encoding preview (${fps} fps)`)
    try {
      await encodePreview({
        ffmpeg,
        dir: seq.dir,
        stem: seq.stem,
        sep: seq.sep,
        ext: seq.ext,
        digits: seq.digits,
        startFrame: seq.frames[0],
        fps,
        out
      })
      job.previewVideo = out
      this.jlog(job, null, 'system', `Preview created: ${out}`)
    } catch (e) {
      this.jlog(job, null, 'warn', `Preview failed: ${(e as Error).message}`)
    }
    this.changed()
  }

  private finishRun(): void {
    if (!this.running) return
    const attempted = this.runTasksStarted > 0
    this.running = false
    this.paused = false
    const done = this.jobs.filter((j) => j.status === 'done').length
    const failed = this.jobs.filter((j) => j.status === 'failed' || j.status === 'partial').length
    const elapsed = this.runStartedAt ? Date.now() - this.runStartedAt : 0
    this.syslog('system', `Queue finished: ${done} complete, ${failed} failed; elapsed: ${formatDuration(elapsed)}`)
    this.endRun()
    if (attempted)
      this.emit('notify', {
        title: 'Queue finished',
        body: `${done} complete, ${failed} failed; elapsed: ${formatDuration(elapsed)}`,
        level: failed ? 'error' : 'info'
      })
    const action = this.app.completionAction
    if (attempted && action !== 'none' && !this.stopRequested) {
      if (this.runHadFailure && !this.app.completionOnFailure) this.syslog('warn', 'Completion action deferred because some scenes failed')
      else this.startCountdown(action)
    }
    this.changed()
  }

  private endRun(): void {
    this.running = false
    this.paused = false
    this.stopWatch()
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.runStartedAt = null
    this.emit('awake', false)
    this.emit('progress', -1)
    this.changed()
  }

  private emitProgress(): void {
    if (!this.running) return
    this.emit('progress', this.stats().progress)
  }

  private startCountdown(action: CompletionAction): void {
    this.completion.pendingAction = action
    this.completion.countdown = this.app.countdownSeconds
    this.syslog('system', `Completion action: ${actionLabel(action)} in ${this.app.countdownSeconds} seconds`)
    this.emit('countdown', action)
    this.countdownTimer = setInterval(() => {
      if (this.completion.countdown === null) return
      this.completion.countdown -= 1
      if (this.completion.countdown <= 0) void this.executeCompletion()
      this.emit('change')
    }, 1000)
    this.changed(false)
  }

  cancelCountdown(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer)
    this.countdownTimer = null
    if (this.completion.pendingAction) this.syslog('system', 'Completion action cancelled')
    this.completion.countdown = null
    this.completion.pendingAction = null
    this.changed(false)
  }

  async executeCompletion(): Promise<void> {
    const action = this.completion.pendingAction
    if (this.countdownTimer) clearInterval(this.countdownTimer)
    this.countdownTimer = null
    this.completion.countdown = null
    this.completion.pendingAction = null
    if (!action) return
    this.saveNow()
    this.changed(false)
    if (action === 'quit') {
      this.syslog('system', 'Application closed')
      this.emit('quit')
      return
    }
    try {
      const line = await runPowerAction(action, this.dryRunPower)
      this.syslog('system', `${actionLabel(action)} executed: ${line}`)
    } catch (e) {
      this.syslog('error', `${actionLabel(action)} failed: ${(e as Error).message}`)
    }
    this.changed(false)
  }

  latestFrame(jobId: string): { frame: number; path: string } | null {
    const job = this.jobs.find((j) => j.id === jobId)
    if (!job) return null
    if (job.lastFrame && fs.existsSync(job.lastFrame.path)) return job.lastFrame
    if (!job.outputDir) return null
    const s = effectiveSettings(this.global, job)
    const hint = prefixHint(resolvedPrefix(s, job))
    const files = scanFrames(job.outputDir, hint)
    if (!files.length) return null
    const seq = primarySequence(files, hint)
    const pool = seq ? files.filter((f) => path.dirname(f.path) === seq.dir && f.stem === seq.stem) : files
    const best = pool.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a))
    return { frame: best.frame, path: best.path }
  }

  hasRunningWork(): boolean {
    return this.running || this.ctxs.size > 0
  }

  async shutdown(): Promise<void> {
    this.disposed = true
    this.running = false
    this.stopRequested = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.logTimer) clearTimeout(this.logTimer)
    if (this.countdownTimer) clearInterval(this.countdownTimer)
    this.stopWatch()
    await Promise.all([...this.ctxs.values()].map((ctx) => ctx.proc.stop()))
    for (const j of this.jobs)
      if (j.status === 'rendering') {
        j.status = 'stopped'
        j.runMode = 'missing'
      }
    this.saveNow()
  }
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${sec}s`
  return `${sec}s`
}

export function actionLabel(a: CompletionAction): string {
  return { none: 'None', sleep: 'Sleep', shutdown: 'Shut down', quit: 'Quit Render Farm' }[a]
}
