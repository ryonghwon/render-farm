import { useEffect } from 'react'
import { CheckCircle2, ChevronRight, CircleSlash, FolderOpen, RotateCcw, ScanSearch, X, XCircle } from 'lucide-react'
import type { AppKind, FormatKey, Job, RenderSettings, SettingsKey, Snapshot } from '@shared/types'
import { useUi } from '../store'
import { Field, NumberInput, Seg, Select, TextInput, Toggle } from './controls'
import { effective, overrideGroups } from './Queue'
import { APP_LABEL, FORMAT_INFO, num, rendererLabel, shortPath } from '../format'

const DEFAULT_CAMS = new Set(['persp', 'top', 'front', 'side'])

export function SceneDialog() {
  const ids = useUi((s) => s.details)
  const close = useUi((s) => s.openDetails)
  const snap = useUi((s) => s.snap)!
  useEffect(() => {
    if (!ids) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close(null)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [ids, close])
  if (!ids) return null
  const jobs = snap.jobs.filter((j) => ids.includes(j.id))
  if (!jobs.length) return null
  const first = jobs[0]
  const single = jobs.length === 1
  const locked = snap.lock.locked
  const rendering = jobs.some((j) => j.status === 'rendering')
  const s = effective(snap, first)
  const over = (k: SettingsKey) => jobs.some((j) => j.overrides[k] !== undefined)
  const set = (patch: Partial<RenderSettings>) => void window.rd.updateJobs(ids, { overrides: patch })
  const reset = (...keys: SettingsKey[]) => void window.rd.updateJobs(ids, { clear: keys })
  const F = (k: SettingsKey) => ({ overridden: over(k), onReset: () => reset(k) })
  const info = first.info
  const anyOverrides = jobs.some((j) => overrideGroups(j) > 0)
  const apps = new Set<AppKind>(jobs.map((j) => j.app))
  const blenderOnly = apps.size === 1 && apps.has('blender')

  const sceneRange = info.start !== null ? `${info.start}-${info.end}` : null
  const tlRange = info.timelineStart !== null ? `${info.timelineStart}-${info.timelineEnd}` : null
  const count = (a: number | null, b: number | null) => (a !== null && b !== null ? b - a + 1 : null)

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <div className="modal" role="dialog" aria-labelledby="sd-title" style={{ width: 'min(680px, calc(100vw - 48px))' }}>
        <div className="modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="sd-title">{single ? `${first.sceneName} settings` : `Settings for ${jobs.length} scenes`}</h2>
            <div className="dlg-sub" title={single ? first.scenePath : undefined}>
              {single ? shortPath(first.scenePath, 3) : 'Changes apply to all selected scenes.'}
            </div>
          </div>
          <button className="btn ghost icon" aria-label="Close" onClick={() => close(null)}>
            <X />
          </button>
        </div>
        <div className="modal-body">
          {rendering && (
            <div className="hint" style={{ color: 'var(--yellow)', marginBottom: 8 }}>
              Settings cannot be changed while a scene is rendering.
            </div>
          )}
          <fieldset disabled={rendering} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <div className="section" style={{ paddingTop: 8 }}>
              <h3>Frame range</h3>
              <div className="choice-list">
                <Choice
                  on={s.frameMode === 'scene' || (blenderOnly && s.frameMode === 'timeline')}
                  onClick={() => set({ frameMode: 'scene' })}
                  main={blenderOnly ? 'Scene frame range' : 'Render range'}
                  sub={
                    single && sceneRange ? `${sceneRange}, ${num(count(info.start, info.end) ?? 0)} frames` : "Each scene's render range"
                  }
                />
                {!blenderOnly && (
                  <Choice
                    on={s.frameMode === 'timeline'}
                    onClick={() => set({ frameMode: 'timeline' })}
                    main="Timeline range"
                    sub={
                      single && tlRange
                        ? `${tlRange}, ${num(count(info.timelineStart, info.timelineEnd) ?? 0)} frames`
                        : "Each scene's timeline range"
                    }
                  />
                )}
                <Choice
                  on={s.frameMode === 'custom'}
                  onClick={() => {
                    if (s.frameMode !== 'custom')
                      set({ frameMode: 'custom', start: first.frames[0] ?? s.start, end: first.frames[first.frames.length - 1] ?? s.end })
                  }}
                  main="Custom"
                  sub="Render a frame range"
                />
              </div>
              {s.frameMode === 'custom' && (
                <div className="field-row" style={{ marginTop: 8, paddingLeft: 36 }}>
                  <NumberInput value={s.start} onCommit={(v) => set({ start: v })} ariaLabel="Start frame" width={76} />
                  <span className="hint">~</span>
                  <NumberInput value={s.end} onCommit={(v) => set({ end: v })} ariaLabel="End frame" width={76} />
                  <span className="hint">Step</span>
                  <NumberInput value={s.step} min={1} onCommit={(v) => set({ step: v })} ariaLabel="Frame step" width={52} />
                </div>
              )}
            </div>

            <div className="section">
              <h3>Camera and output</h3>
              <Field label="Camera" {...F('camera')}>
                <Select
                  value={s.camera}
                  options={[
                    {
                      value: '',
                      label: `Use scene setting${
                        single && info.cameras.some((c) => c.renderable)
                          ? ` (${info.cameras
                              .filter((c) => c.renderable)
                              .map((c) => c.name)
                              .join(', ')})`
                          : ''
                      }`
                    },
                    ...(single ? info.cameras : []).map((c) => ({
                      value: c.name,
                      label: `${c.name}${first.app === 'maya' && DEFAULT_CAMS.has(c.name) ? ' (default camera)' : ''}`
                    }))
                  ]}
                  onChange={(v) => set({ camera: v })}
                  ariaLabel="Camera"
                />
              </Field>
              {single && info.layers.length > 1 && (
                <LayerField job={first} s={s} over={over('layers')} onReset={() => reset('layers')} onChange={(v) => set({ layers: v })} />
              )}
              <Field
                label="Resolution"
                overridden={over('resolutionMode') || over('width') || over('height')}
                onReset={() => reset('resolutionMode', 'width', 'height')}
              >
                <Seg
                  small
                  value={s.resolutionMode}
                  disabled={locked}
                  options={[
                    {
                      value: 'scene',
                      label: single && info.width ? `Use scene setting (${info.width}×${info.height})` : 'Use scene setting'
                    },
                    { value: 'custom', label: 'Custom' }
                  ]}
                  onChange={(v) => set({ resolutionMode: v })}
                />
                {s.resolutionMode === 'custom' && (
                  <div className="field-row">
                    <NumberInput value={s.width} min={16} onCommit={(v) => set({ width: v })} ariaLabel="Width" width={72} />
                    <span className="hint">×</span>
                    <NumberInput value={s.height} min={16} onCommit={(v) => set({ height: v })} ariaLabel="Height" width={72} />
                    <Select
                      value=""
                      options={[
                        { value: '', label: 'Presets' },
                        { value: '1920x1080', label: 'HD 1920×1080' },
                        { value: '1280x720', label: 'HD 1280×720' },
                        { value: '3840x2160', label: 'UHD 3840×2160' },
                        { value: '1080x1920', label: 'Portrait 1080×1920' }
                      ]}
                      onChange={(v) => {
                        if (!v) return
                        const [w, h] = v.split('x').map(Number)
                        set({ width: w, height: h })
                      }}
                      ariaLabel="Resolution preset"
                    />
                  </div>
                )}
              </Field>
              <Field label="File format" {...F('format')} hint={FORMAT_INFO[s.format]?.desc}>
                <Seg
                  small
                  disabled={locked}
                  value={job_format(first)}
                  options={[
                    { value: '__default', label: `Default (${FORMAT_INFO[snap.global.format]?.label})` },
                    { value: 'exr', label: 'EXR' },
                    { value: 'png', label: 'PNG' },
                    { value: 'jpg', label: 'JPEG' },
                    { value: 'tif', label: 'TIFF' }
                  ]}
                  onChange={(v) => (v === '__default' ? reset('format') : set({ format: v as FormatKey }))}
                />
              </Field>
            </div>

            {locked ? (
              <div className="hint" style={{ padding: '12px 0' }}>
                Advanced settings are locked.
              </div>
            ) : (
              <details className="more">
                <summary>
                  <ChevronRight />
                  Advanced settings
                </summary>
                <AdvancedFields snap={snap} first={first} s={s} F={F} set={set} apps={apps} />
              </details>
            )}
          </fieldset>

          {single && (
            <details className="more">
              <summary>
                <ChevronRight />
                Scene information
              </summary>
              <SceneInfo job={first} snap={snap} />
            </details>
          )}
        </div>
        <div className="modal-foot" style={{ justifyContent: 'space-between' }}>
          <button
            className="btn ghost"
            disabled={!anyOverrides || rendering}
            onClick={() => window.rd.updateJobs(ids, { clear: Object.keys(snap.global) as SettingsKey[] })}
          >
            <RotateCcw />
            Restore defaults
          </button>
          <button className="btn primary" onClick={() => close(null)}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function job_format(j: Job): string {
  return j.overrides.format ?? '__default'
}

function Choice({ on, onClick, main, sub }: { on: boolean; onClick: () => void; main: string; sub?: string }) {
  return (
    <button className={`choice${on ? ' on' : ''}`} role="radio" aria-checked={on} onClick={onClick}>
      <span className="radio" />
      <span className="c-main">{main}</span>
      {sub && <span className="c-sub">{sub}</span>}
    </button>
  )
}

const RENDERER_OPTS: { value: RenderSettings['renderer']; label: string }[] = [
  { value: 'scene', label: 'Use scene setting' },
  { value: 'arnold', label: 'Arnold' },
  { value: 'sw', label: 'Maya Software' },
  { value: 'hw2', label: 'Maya Hardware 2.0' },
  { value: 'redshift', label: 'Redshift' },
  { value: 'vray', label: 'V-Ray' }
]

export function AdvancedFields({
  snap,
  first,
  s,
  F,
  set,
  apps
}: {
  snap: Snapshot
  first: Job | null
  s: RenderSettings
  F: (k: SettingsKey) => { overridden: boolean; onReset: () => void }
  set: (patch: Partial<RenderSettings>) => void
  apps: Set<AppKind>
}) {
  const pickOut = async () => {
    const p = await window.rd.pickOutputDir(s.outputRoot)
    if (p) set({ outputRoot: p })
  }
  const both = apps.size > 1
  const maya = apps.has('maya')
  const blender = apps.has('blender')
  const versionOpts = (app: AppKind) => [
    { value: 'auto', label: 'Automatic (scene version)' },
    ...snap.installs.filter((i) => i.app === app).map((i) => ({ value: i.id, label: `${APP_LABEL[app]} ${i.version}` }))
  ]
  return (
    <div style={{ paddingBottom: 8 }}>
      {maya && (
        <>
          <Field
            label={both ? 'Maya renderer' : 'Renderer'}
            {...F('renderer')}
            hint={s.renderer === 'scene' && first ? `Scene renderer: ${rendererLabel(first.info.renderer)}` : undefined}
          >
            <Select value={s.renderer} options={RENDERER_OPTS} onChange={(v) => set({ renderer: v })} ariaLabel="Renderer" />
          </Field>
          <Field label="Maya version" {...F('mayaVersion')}>
            <Select
              value={snap.installs.some((i) => i.id === s.mayaVersion) ? s.mayaVersion : 'auto'}
              options={versionOpts('maya')}
              onChange={(v) => set({ mayaVersion: v })}
              ariaLabel="Maya version"
            />
          </Field>
        </>
      )}
      {blender && (
        <>
          <Field
            label={both ? 'Blender render device' : 'Render device'}
            {...F('device')}
            hint="Applies to Cycles. EEVEE always uses the GPU."
          >
            <Seg
              small
              value={s.device}
              options={[
                { value: 'auto', label: 'Automatic (prefer GPU)' },
                { value: 'cpu', label: 'CPU' },
                { value: 'scene', label: 'Use scene setting' }
              ]}
              onChange={(v) => set({ device: v })}
            />
          </Field>
          <Field label="Blender version" {...F('blenderVersion')}>
            <Select
              value={snap.installs.some((i) => i.id === s.blenderVersion) ? s.blenderVersion : 'auto'}
              options={versionOpts('blender')}
              onChange={(v) => set({ blenderVersion: v })}
              ariaLabel="Blender version"
            />
          </Field>
        </>
      )}
      {first && (
        <Field label="Output folder" {...F('outputRoot')} hint="Choose a different output location for this scene.">
          <div className="field-row">
            <div className="path-box" onClick={pickOut} title={s.outputRoot}>
              <span>
                <bdi>{s.outputRoot || 'Not set'}</bdi>
              </span>
            </div>
            <button className="btn icon" aria-label="Choose folder" onClick={pickOut}>
              <FolderOpen />
            </button>
          </div>
        </Field>
      )}
      <Field
        label="Subfolder"
        {...F('folderPattern')}
        hint="{scene} is replaced with the scene name. Leave blank to save directly to the output folder."
      >
        <TextInput
          value={s.folderPattern}
          onCommit={(v) => set({ folderPattern: v })}
          placeholder="{scene}"
          mono
          ariaLabel="Subfolder pattern"
        />
      </Field>
      <Field
        label="File name"
        {...F('filePrefix')}
        hint={
          maya
            ? `Available tokens: {scene}, {camera}, <RenderLayer>, <RenderPass>${blender ? ' (angle-bracket tokens are Maya only)' : ''}`
            : 'Available tokens: {scene}, {camera}'
        }
      >
        <TextInput
          value={s.filePrefix}
          onCommit={(v) => set({ filePrefix: v || '{scene}' })}
          placeholder="{scene}"
          mono
          ariaLabel="File name pattern"
        />
      </Field>
      <Field label="Frame padding" {...F('padding')}>
        <div className="field-row">
          <NumberInput value={s.padding} min={1} max={8} onCommit={(v) => set({ padding: v })} ariaLabel="Frame padding" width={56} />
          <span className="hint">Example: name.{'0'.repeat(Math.max(0, s.padding - 1))}1.exr</span>
        </div>
      </Field>
      <Field label="Existing frames" {...F('skipExisting')}>
        <Toggle
          on={s.skipExisting}
          onChange={(v) => set({ skipExisting: v })}
          label="Skip"
          hint="Skip frames with matching file names in the output folder."
        />
      </Field>
      <Field
        label="Chunk size"
        {...F('chunkSize')}
        hint="Split scenes into groups of frames for parallel rendering. Set to 0 to keep each scene in one task."
      >
        <div className="field-row">
          <NumberInput value={s.chunkSize} min={0} onCommit={(v) => set({ chunkSize: v })} ariaLabel="Chunk size" width={64} />
          <span className="hint">frames</span>
        </div>
      </Field>
      <Field label="Preview video" {...F('makePreview')}>
        <Toggle
          on={s.makePreview}
          onChange={(v) => set({ makePreview: v })}
          label="Create MP4 after rendering"
          hint="Creates an MP4 from rendered images in the output folder. Requires FFmpeg."
        />
      </Field>
      <Field
        label="Additional arguments"
        {...F('extraArgs')}
        hint={
          both
            ? 'Appended to the render command line.'
            : blender
              ? "Inserted before Blender's render command (-a)."
              : 'Appended to the Maya Render command line.'
        }
      >
        <TextInput
          value={s.extraArgs}
          onCommit={(v) => set({ extraArgs: v })}
          placeholder={blender && !maya ? 'Example: -E CYCLES' : 'Example: -ai:as 3'}
          mono
          ariaLabel="Additional arguments"
        />
      </Field>
      {first?.outputExample && (
        <div className="example" title={first.outputExample}>
          Output path example <b>{first.outputExample}</b>
        </div>
      )}
    </div>
  )
}

function LayerField({
  job,
  s,
  over,
  onReset,
  onChange
}: {
  job: Job
  s: RenderSettings
  over: boolean
  onReset: () => void
  onChange: (v: string[] | null) => void
}) {
  const all = job.info.layers
  const sceneDefault = s.layers === null
  const chosen = new Set(s.layers ?? all.filter((l) => l.renderable).map((l) => l.name))
  return (
    <Field label={job.app === 'blender' ? 'View layers' : 'Render layers'} overridden={over} onReset={onReset}>
      <Toggle on={sceneDefault} onChange={(v) => onChange(v ? null : [...chosen])} label="All enabled scene layers" />
      {!sceneDefault && (
        <div className="layer-list">
          {all.map((l) => (
            <label key={l.name} className="layer-item">
              <input
                type="checkbox"
                checked={chosen.has(l.name)}
                onChange={(e) => {
                  const next = new Set(chosen)
                  if (e.target.checked) next.add(l.name)
                  else next.delete(l.name)
                  onChange([...next])
                }}
              />
              {l.name === 'defaultRenderLayer' ? 'masterLayer' : l.name}
            </label>
          ))}
        </div>
      )}
    </Field>
  )
}

function SceneInfo({ job, snap }: { job: Job; snap: Snapshot }) {
  const i = job.info
  const blender = job.app === 'blender'
  const canDeep = !blender && snap.installs.some((x) => x.mayapyPath)
  const missing = i.missingFiles ?? []
  if (i.state === 'pending' || i.state === 'running') return <div className="hint">Inspecting scene</div>
  return (
    <div style={{ paddingBottom: 8 }}>
      <dl className="kv">
        {blender ? (
          <>
            <dt>Scene</dt>
            <dd>{i.sceneName ?? '-'}</dd>
          </>
        ) : (
          <>
            <dt>Project folder</dt>
            <dd>{job.project ?? 'None (workspace.mel not found)'}</dd>
          </>
        )}
        <dt>Saved with</dt>
        <dd>{i.version ? `${APP_LABEL[job.app]} ${i.version}` : '-'}</dd>
        <dt>Renderer</dt>
        <dd>{rendererLabel(i.renderer)}</dd>
        <dt>{blender ? 'Frame range' : 'Render range'}</dt>
        <dd>
          {i.start ?? '-'} - {i.end ?? '-'}
          {i.step && i.step > 1 ? `, step ${i.step}` : ''}
          {i.animation === false ? '(animation disabled)' : ''}
        </dd>
        {!blender && (
          <>
            <dt>Timeline</dt>
            <dd>{i.timelineStart !== null ? `${i.timelineStart} - ${i.timelineEnd}` : '-'}</dd>
          </>
        )}
        <dt>Resolution</dt>
        <dd>{i.width ? `${i.width}×${i.height}` : '-'}</dd>
        <dt>Frame rate</dt>
        <dd>{i.fps ? `${i.fps}fps` : '-'}</dd>
        <dt>Camera</dt>
        <dd>
          <div className="list">
            {i.cameras.length === 0 && <span className="hint">Not available</span>}
            {i.cameras.map((c) => (
              <div key={c.name} className="list-item">
                {c.renderable ? <CheckCircle2 className="ok-ic" /> : <CircleSlash className="info-ic" />}
                <span className="p">{c.name}</span>
                {c.renderable && <span className="hint">Render cameras</span>}
              </div>
            ))}
          </div>
        </dd>
        <dt>{blender ? 'Linked files' : 'Reference files'}</dt>
        <dd>
          <div className="list">
            {i.references.length === 0 && <span className="hint">None</span>}
            {i.references.map((r) => (
              <div key={r.path} className="list-item" title={r.resolved}>
                {r.exists ? <CheckCircle2 className="ok-ic" /> : <XCircle className="bad-ic" />}
                <span className="p">{r.path}</span>
              </div>
            ))}
          </div>
        </dd>
        {missing.length > 0 && (
          <>
            <dt>Missing textures</dt>
            <dd>
              <div className="list">
                {missing.map((m) => (
                  <div key={m} className="list-item">
                    <XCircle className="bad-ic" />
                    <span className="p">{m}</span>
                  </div>
                ))}
              </div>
            </dd>
          </>
        )}
      </dl>
      {i.method === 'binary' && (
        <div className="hint" style={{ marginTop: 10 }}>
          Only version information is read directly from .mb files. Detailed inspection opens the scene with Maya to read cameras and frame
          settings.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn small" disabled={job.status === 'rendering'} onClick={() => window.rd.reprobe([job.id], false)}>
          <RotateCcw />
          Inspect again
        </button>
        {!blender && (
          <button
            className="btn small"
            disabled={job.status === 'rendering' || !canDeep}
            title={canDeep ? 'Open and inspect the scene with Maya (mayapy)' : 'Requires a Maya installation with mayapy'}
            onClick={() => window.rd.reprobe([job.id], true)}
          >
            <ScanSearch />
            Detailed inspection
          </button>
        )}
      </div>
    </div>
  )
}
