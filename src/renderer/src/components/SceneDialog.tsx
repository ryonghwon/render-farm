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
            <h2 id="sd-title">{single ? `${first.sceneName} 설정` : `씬 ${jobs.length}개 설정`}</h2>
            <div className="dlg-sub" title={single ? first.scenePath : undefined}>
              {single ? shortPath(first.scenePath, 3) : '변경 사항이 선택한 모든 씬에 적용됩니다.'}
            </div>
          </div>
          <button className="btn ghost icon" aria-label="닫기" onClick={() => close(null)}>
            <X />
          </button>
        </div>
        <div className="modal-body">
          {rendering && (
            <div className="hint" style={{ color: 'var(--yellow)', marginBottom: 8 }}>
              렌더 중인 씬은 설정을 변경할 수 없습니다.
            </div>
          )}
          <fieldset disabled={rendering} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <div className="section" style={{ paddingTop: 8 }}>
              <h3>프레임 범위</h3>
              <div className="choice-list">
                <Choice
                  on={s.frameMode === 'scene' || (blenderOnly && s.frameMode === 'timeline')}
                  onClick={() => set({ frameMode: 'scene' })}
                  main={blenderOnly ? '씬 프레임 범위' : '렌더 설정 범위'}
                  sub={single && sceneRange ? `${sceneRange}, ${num(count(info.start, info.end) ?? 0)}프레임` : '씬별 렌더 설정값'}
                />
                {!blenderOnly && (
                  <Choice
                    on={s.frameMode === 'timeline'}
                    onClick={() => set({ frameMode: 'timeline' })}
                    main="타임라인 범위"
                    sub={
                      single && tlRange
                        ? `${tlRange}, ${num(count(info.timelineStart, info.timelineEnd) ?? 0)}프레임`
                        : '씬별 타임라인 재생 범위'
                    }
                  />
                )}
                <Choice
                  on={s.frameMode === 'custom'}
                  onClick={() => {
                    if (s.frameMode !== 'custom')
                      set({ frameMode: 'custom', start: first.frames[0] ?? s.start, end: first.frames[first.frames.length - 1] ?? s.end })
                  }}
                  main="사용자 지정"
                  sub="구간 재렌더"
                />
              </div>
              {s.frameMode === 'custom' && (
                <div className="field-row" style={{ marginTop: 8, paddingLeft: 36 }}>
                  <NumberInput value={s.start} onCommit={(v) => set({ start: v })} ariaLabel="시작 프레임" width={76} />
                  <span className="hint">~</span>
                  <NumberInput value={s.end} onCommit={(v) => set({ end: v })} ariaLabel="끝 프레임" width={76} />
                  <span className="hint">간격</span>
                  <NumberInput value={s.step} min={1} onCommit={(v) => set({ step: v })} ariaLabel="프레임 간격" width={52} />
                </div>
              )}
            </div>

            <div className="section">
              <h3>카메라와 저장</h3>
              <Field label="카메라" {...F('camera')}>
                <Select
                  value={s.camera}
                  options={[
                    {
                      value: '',
                      label: `씬 그대로${
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
                      label: `${c.name}${first.app === 'maya' && DEFAULT_CAMS.has(c.name) ? ' (기본 카메라)' : ''}`
                    }))
                  ]}
                  onChange={(v) => set({ camera: v })}
                  ariaLabel="카메라"
                />
              </Field>
              {single && info.layers.length > 1 && (
                <LayerField job={first} s={s} over={over('layers')} onReset={() => reset('layers')} onChange={(v) => set({ layers: v })} />
              )}
              <Field
                label="해상도"
                overridden={over('resolutionMode') || over('width') || over('height')}
                onReset={() => reset('resolutionMode', 'width', 'height')}
              >
                <Seg
                  small
                  value={s.resolutionMode}
                  disabled={locked}
                  options={[
                    { value: 'scene', label: single && info.width ? `씬 그대로 ${info.width}×${info.height}` : '씬 그대로' },
                    { value: 'custom', label: '사용자 지정' }
                  ]}
                  onChange={(v) => set({ resolutionMode: v })}
                />
                {s.resolutionMode === 'custom' && (
                  <div className="field-row">
                    <NumberInput value={s.width} min={16} onCommit={(v) => set({ width: v })} ariaLabel="가로" width={72} />
                    <span className="hint">×</span>
                    <NumberInput value={s.height} min={16} onCommit={(v) => set({ height: v })} ariaLabel="세로" width={72} />
                    <Select
                      value=""
                      options={[
                        { value: '', label: '프리셋' },
                        { value: '1920x1080', label: 'HD 1920×1080' },
                        { value: '1280x720', label: 'HD 1280×720' },
                        { value: '3840x2160', label: 'UHD 3840×2160' },
                        { value: '1080x1920', label: '세로 1080×1920' }
                      ]}
                      onChange={(v) => {
                        if (!v) return
                        const [w, h] = v.split('x').map(Number)
                        set({ width: w, height: h })
                      }}
                      ariaLabel="해상도 프리셋"
                    />
                  </div>
                )}
              </Field>
              <Field label="파일 형식" {...F('format')} hint={FORMAT_INFO[s.format]?.desc}>
                <Seg
                  small
                  disabled={locked}
                  value={job_format(first)}
                  options={[
                    { value: '__default', label: `기본값 (${FORMAT_INFO[snap.global.format]?.label})` },
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
                고급 설정은 관리자 잠금 상태입니다.
              </div>
            ) : (
              <details className="more">
                <summary>
                  <ChevronRight />
                  고급 설정
                </summary>
                <AdvancedFields snap={snap} first={first} s={s} F={F} set={set} apps={apps} />
              </details>
            )}
          </fieldset>

          {single && (
            <details className="more">
              <summary>
                <ChevronRight />씬 정보
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
            기본값 복원
          </button>
          <button className="btn primary" onClick={() => close(null)}>
            완료
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
  { value: 'scene', label: '씬 그대로' },
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
    { value: 'auto', label: '자동 (씬 저장 버전)' },
    ...snap.installs.filter((i) => i.app === app).map((i) => ({ value: i.id, label: `${APP_LABEL[app]} ${i.version}` }))
  ]
  return (
    <div style={{ paddingBottom: 8 }}>
      {maya && (
        <>
          <Field
            label={both ? 'Maya 렌더러' : '렌더러'}
            {...F('renderer')}
            hint={s.renderer === 'scene' && first ? `씬 렌더러: ${rendererLabel(first.info.renderer)}` : undefined}
          >
            <Select value={s.renderer} options={RENDERER_OPTS} onChange={(v) => set({ renderer: v })} ariaLabel="렌더러" />
          </Field>
          <Field label="Maya 버전" {...F('mayaVersion')}>
            <Select
              value={snap.installs.some((i) => i.id === s.mayaVersion) ? s.mayaVersion : 'auto'}
              options={versionOpts('maya')}
              onChange={(v) => set({ mayaVersion: v })}
              ariaLabel="Maya 버전"
            />
          </Field>
        </>
      )}
      {blender && (
        <>
          <Field
            label={both ? 'Blender 렌더 장치' : '렌더 장치'}
            {...F('device')}
            hint="Cycles에 적용됩니다. EEVEE는 항상 GPU로 렌더합니다."
          >
            <Seg
              small
              value={s.device}
              options={[
                { value: 'auto', label: '자동 (GPU 우선)' },
                { value: 'cpu', label: 'CPU' },
                { value: 'scene', label: '씬 그대로' }
              ]}
              onChange={(v) => set({ device: v })}
            />
          </Field>
          <Field label="Blender 버전" {...F('blenderVersion')}>
            <Select
              value={snap.installs.some((i) => i.id === s.blenderVersion) ? s.blenderVersion : 'auto'}
              options={versionOpts('blender')}
              onChange={(v) => set({ blenderVersion: v })}
              ariaLabel="Blender 버전"
            />
          </Field>
        </>
      )}
      {first && (
        <Field label="저장 폴더" {...F('outputRoot')} hint="이 씬만 다른 위치에 저장할 때 지정합니다.">
          <div className="field-row">
            <div className="path-box" onClick={pickOut} title={s.outputRoot}>
              <span>
                <bdi>{s.outputRoot || '지정되지 않음'}</bdi>
              </span>
            </div>
            <button className="btn icon" aria-label="폴더 선택" onClick={pickOut}>
              <FolderOpen />
            </button>
          </div>
        </Field>
      )}
      <Field label="하위 폴더" {...F('folderPattern')} hint="{scene}은 씬 이름으로 대체됩니다. 비워 두면 저장 폴더에 바로 저장합니다.">
        <TextInput
          value={s.folderPattern}
          onCommit={(v) => set({ folderPattern: v })}
          placeholder="{scene}"
          mono
          ariaLabel="하위 폴더 규칙"
        />
      </Field>
      <Field
        label="파일 이름"
        {...F('filePrefix')}
        hint={
          maya
            ? `사용 가능한 토큰: {scene}, {camera}, <RenderLayer>, <RenderPass>${blender ? ' (<>는 Maya 전용)' : ''}`
            : '사용 가능한 토큰: {scene}, {camera}'
        }
      >
        <TextInput
          value={s.filePrefix}
          onCommit={(v) => set({ filePrefix: v || '{scene}' })}
          placeholder="{scene}"
          mono
          ariaLabel="파일 이름 규칙"
        />
      </Field>
      <Field label="프레임 자릿수" {...F('padding')}>
        <div className="field-row">
          <NumberInput value={s.padding} min={1} max={8} onCommit={(v) => set({ padding: v })} ariaLabel="프레임 자릿수" width={56} />
          <span className="hint">예: name.{'0'.repeat(Math.max(0, s.padding - 1))}1.exr</span>
        </div>
      </Field>
      <Field label="기존 프레임" {...F('skipExisting')}>
        <Toggle
          on={s.skipExisting}
          onChange={(v) => set({ skipExisting: v })}
          label="건너뛰기"
          hint="저장 폴더에 같은 이름의 프레임이 있으면 렌더하지 않습니다."
        />
      </Field>
      <Field label="청크 크기" {...F('chunkSize')} hint="병렬 렌더 시 씬을 지정한 프레임 수 단위로 분할합니다. 0은 분할하지 않습니다.">
        <div className="field-row">
          <NumberInput value={s.chunkSize} min={0} onCommit={(v) => set({ chunkSize: v })} ariaLabel="청크 크기" width={64} />
          <span className="hint">프레임</span>
        </div>
      </Field>
      <Field label="프리뷰 영상" {...F('makePreview')}>
        <Toggle
          on={s.makePreview}
          onChange={(v) => set({ makePreview: v })}
          label="렌더가 끝나면 MP4 만들기"
          hint="렌더된 이미지로 저장 폴더에 MP4를 만듭니다. ffmpeg가 필요합니다."
        />
      </Field>
      <Field
        label="추가 인수"
        {...F('extraArgs')}
        hint={
          both
            ? '각 프로그램의 렌더 명령줄에 그대로 추가합니다.'
            : blender
              ? 'Blender 명령줄의 렌더 시작(-a) 앞에 추가합니다.'
              : 'Maya Render 명령줄에 그대로 추가합니다.'
        }
      >
        <TextInput
          value={s.extraArgs}
          onCommit={(v) => set({ extraArgs: v })}
          placeholder={blender && !maya ? '예: -E CYCLES' : '예: -ai:as 3'}
          mono
          ariaLabel="추가 인수"
        />
      </Field>
      {first?.outputExample && (
        <div className="example" title={first.outputExample}>
          저장 경로 예시 <b>{first.outputExample}</b>
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
    <Field label={job.app === 'blender' ? '뷰 레이어' : '렌더 레이어'} overridden={over} onReset={onReset}>
      <Toggle on={sceneDefault} onChange={(v) => onChange(v ? null : [...chosen])} label="씬에서 켜진 레이어 전체" />
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
  if (i.state === 'pending' || i.state === 'running') return <div className="hint">씬 분석 중</div>
  return (
    <div style={{ paddingBottom: 8 }}>
      <dl className="kv">
        {blender ? (
          <>
            <dt>씬</dt>
            <dd>{i.sceneName ?? '-'}</dd>
          </>
        ) : (
          <>
            <dt>프로젝트 폴더</dt>
            <dd>{job.project ?? '없음 (workspace.mel 미검출)'}</dd>
          </>
        )}
        <dt>저장 버전</dt>
        <dd>{i.version ? `${APP_LABEL[job.app]} ${i.version}` : '-'}</dd>
        <dt>렌더러</dt>
        <dd>{rendererLabel(i.renderer)}</dd>
        <dt>{blender ? '프레임 범위' : '렌더 설정 범위'}</dt>
        <dd>
          {i.start ?? '-'} - {i.end ?? '-'}
          {i.step && i.step > 1 ? `, 간격 ${i.step}` : ''}
          {i.animation === false ? ' (애니메이션 비활성)' : ''}
        </dd>
        {!blender && (
          <>
            <dt>타임라인</dt>
            <dd>{i.timelineStart !== null ? `${i.timelineStart} - ${i.timelineEnd}` : '-'}</dd>
          </>
        )}
        <dt>해상도</dt>
        <dd>{i.width ? `${i.width}×${i.height}` : '-'}</dd>
        <dt>프레임 속도</dt>
        <dd>{i.fps ? `${i.fps}fps` : '-'}</dd>
        <dt>카메라</dt>
        <dd>
          <div className="list">
            {i.cameras.length === 0 && <span className="hint">정보 없음</span>}
            {i.cameras.map((c) => (
              <div key={c.name} className="list-item">
                {c.renderable ? <CheckCircle2 className="ok-ic" /> : <CircleSlash className="info-ic" />}
                <span className="p">{c.name}</span>
                {c.renderable && <span className="hint">렌더 카메라</span>}
              </div>
            ))}
          </div>
        </dd>
        <dt>{blender ? '링크된 파일' : '참조 파일'}</dt>
        <dd>
          <div className="list">
            {i.references.length === 0 && <span className="hint">없음</span>}
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
            <dt>없는 텍스처</dt>
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
          .mb 파일은 버전 정보만 직접 읽을 수 있습니다. 정밀 분석 시 Maya로 씬을 열어 카메라와 프레임 범위를 확인합니다.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn small" disabled={job.status === 'rendering'} onClick={() => window.rd.reprobe([job.id], false)}>
          <RotateCcw />
          다시 분석
        </button>
        {!blender && (
          <button
            className="btn small"
            disabled={job.status === 'rendering' || !canDeep}
            title={canDeep ? 'Maya(mayapy)로 씬을 열어 분석합니다' : 'mayapy가 포함된 Maya 설치가 필요합니다'}
            onClick={() => window.rd.reprobe([job.id], true)}
          >
            <ScanSearch />
            정밀 분석
          </button>
        )}
      </div>
    </div>
  )
}
