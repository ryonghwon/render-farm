import { useMemo } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, FilePlus2, FolderPlus, MoreHorizontal, ScrollText, Upload } from 'lucide-react'
import type { Job, RenderSettings, Snapshot } from '@shared/types'
import { useUi } from '../store'
import { FrameStrip } from './FrameStrip'
import { APP_LABEL, duration, frameRange, num, waitLabel, FORMAT_INFO } from '../format'
import { addScenes, applyFix, dismissIssue } from '../actions'

export function effective(snap: Snapshot, job: Job): RenderSettings {
  return { ...snap.global, ...job.overrides } as RenderSettings
}

export function overrideGroups(job: Job): number {
  const groups = new Set(
    Object.keys(job.overrides).map((k) => {
      if (['frameMode', 'start', 'end', 'step'].includes(k)) return 'frames'
      if (['resolutionMode', 'width', 'height'].includes(k)) return 'res'
      if (['makePreview', 'previewFps'].includes(k)) return 'preview'
      return k
    })
  )
  return groups.size
}

export function Queue({ dragActive }: { dragActive: boolean }) {
  const snap = useUi((s) => s.snap)!
  const selected = useUi((s) => s.selected)
  const setSnap = useUi((s) => s.setSnap)
  const setSelected = useUi((s) => s.setSelected)
  const openDetails = useUi((s) => s.openDetails)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const ids = useMemo(() => snap.jobs.map((j) => j.id), [snap.jobs])
  const enabled = snap.jobs.filter((j) => j.enabled)
  const totalFrames = enabled.reduce((a, j) => a + j.frames.length, 0)
  const selJobs = snap.jobs.filter((j) => selected.includes(j.id))
  const anyRendering = selJobs.some((j) => j.status === 'rendering')
  const hasFinished = snap.jobs.some((j) => j.status === 'done' || j.status === 'skipped')
  const logOpen = snap.app.logOpen

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const jobs = arrayMove(snap.jobs, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)))
    setSnap({ ...snap, jobs })
    void window.rd.reorderJobs(jobs.map((j) => j.id))
  }

  return (
    <section className="card queue" aria-label="렌더 목록">
      <div className="queue-head">
        {selJobs.length ? (
          <div className="sel">
            <span className="sel-count">{selJobs.length}개 선택됨</span>
            <button className="btn small" onClick={() => openDetails(selected)}>
              씬 설정
            </button>
            <button
              className="btn small"
              disabled={anyRendering}
              onClick={() => {
                void window.rd.removeJobs(selected)
                setSelected([])
              }}
            >
              목록에서 빼기
            </button>
            <button className="link" onClick={() => setSelected([])}>
              선택 해제
            </button>
          </div>
        ) : (
          <>
            <h2>렌더 목록</h2>
            {snap.jobs.length > 0 && (
              <span className="q-count">
                씬 {enabled.length}개, {num(totalFrames)}프레임
              </span>
            )}
          </>
        )}
        <span className="spacer" />
        {hasFinished && !selJobs.length && (
          <button className="btn small ghost" onClick={() => window.rd.clearFinished()}>
            끝난 씬 지우기
          </button>
        )}
        <button className={`btn small${logOpen ? ' on' : ' outline'}`} aria-pressed={logOpen} onClick={() => window.rd.updateApp({ logOpen: !logOpen })}>
          <ScrollText />
          로그
        </button>
      </div>
      {snap.jobs.length === 0 ? (
        <div className="empty">
          <div className="empty-inner">
            <div className="empty-icon" aria-hidden>
              <Upload />
            </div>
            <h2>렌더 목록이 비어 있습니다</h2>
            <p>Maya(.ma, .mb)와 Blender(.blend) 파일이나 폴더를 끌어 놓아 씬을 추가합니다.</p>
            <div className="actions">
              <button className="btn primary" onClick={() => addScenes('files')}>
                <FilePlus2 />
                파일 추가…
              </button>
              <button className="btn outline" onClick={() => addScenes('folder')}>
                <FolderPlus />
                폴더 추가…
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rows" onClick={(e) => e.target === e.currentTarget && setSelected([])}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {snap.jobs.map((j) => (
                <Row key={j.id} job={j} snap={snap} selected={selected.includes(j.id)} />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
      {dragActive && (
        <div className="drop-overlay">
          <div>
            놓으면 렌더 목록에 추가
            <small>.ma, .mb, .blend 파일 또는 폴더</small>
          </div>
        </div>
      )}
    </section>
  )
}

interface StatusView {
  kind: 'pct' | 'badge' | 'text'
  main: string
  tone?: string
  sub?: string
}

function statusOf(job: Job): StatusView {
  const total = job.frames.length
  const done = Math.min(job.doneFrames.length, total)
  const pct = total ? Math.floor((done / total) * 100) : 0
  if (job.info.state === 'pending' || job.info.state === 'running') return { kind: 'text', main: '분석 중' }
  if (!job.enabled && job.status === 'idle') return { kind: 'text', main: '제외' }
  switch (job.status) {
    case 'rendering': {
      const cur = job.tasks.find((t) => t.status === 'running')
      const sub = waitLabel(job) ?? (job.etaMs ? `남은 시간 ${duration(job.etaMs, true)}` : cur?.currentFrame != null ? `프레임 ${cur.currentFrame}` : '씬 여는 중')
      return { kind: 'pct', main: `${pct}`, sub }
    }
    case 'done':
      return { kind: 'badge', main: '완료', tone: 'done', sub: duration(job.elapsedMs) }
    case 'partial':
      return { kind: 'badge', main: '빠진 프레임', tone: 'warn', sub: `${num(job.missingFrames.length)}개` }
    case 'failed':
      return { kind: 'badge', main: '실패', tone: 'failed' }
    case 'stopped':
      return { kind: 'badge', main: `중지됨 ${pct}%`, tone: 'plain', sub: '이어서 렌더 가능' }
    case 'skipped':
      return { kind: 'text', main: '건너뜀' }
    default:
      return { kind: 'text', main: '대기' }
  }
}

function Row({ job, snap, selected }: { job: Job; snap: Snapshot; selected: boolean }) {
  const select = useUi((s) => s.select)
  const openMenu = useUi((s) => s.openMenu)
  const openDetails = useUi((s) => s.openDetails)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id })
  const s = effective(snap, job)
  const info = job.info
  const editable = job.status !== 'rendering'
  const locked = snap.lock.locked
  const overrides = overrideGroups(job)
  const busy = info.state === 'pending' || info.state === 'running'
  const renderCams = info.cameras.filter((c) => c.renderable).map((c) => c.name)
  const camera = s.camera || renderCams.join(', ') || '카메라 미지정'
  const st = statusOf(job)
  const issues = job.status === 'done' ? [] : job.issues.filter((i) => i.level === 'error' || i.level === 'warn')
  const issue = issues[0]
  const failNote = (job.status === 'failed' || job.status === 'partial') && job.error && !issue
  const off = (!job.enabled && job.status === 'idle') || job.status === 'skipped'

  const onClick = (e: React.MouseEvent) => {
    if (e.shiftKey) select(job.id, 'range')
    else if (e.ctrlKey || e.metaKey) select(job.id, 'toggle')
    else select(job.id, 'single')
  }

  const canFix = issue?.fix && editable && (!locked || !issue.fix.patch || Object.keys(issue.fix.patch).every((k) => ['frameMode', 'start', 'end', 'step', 'camera', 'layers'].includes(k)))

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`row${selected ? ' selected' : ''}${off ? ' off' : ''}${isDragging ? ' dragging' : ''}${job.status === 'rendering' ? ' live' : ''}`}
      onClick={onClick}
      onDoubleClick={() => openDetails([job.id])}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!selected) select(job.id, 'single')
        openMenu({ x: e.clientX, y: e.clientY, jobId: job.id })
      }}
      {...attributes}
      {...listeners}
      role="option"
      aria-selected={selected}
      aria-roledescription="씬"
    >
      <button
        className={`check${job.enabled ? ' on' : ''}`}
        aria-label={job.enabled ? '렌더 대상에서 제외' : '렌더 대상에 포함'}
        disabled={!editable}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          void window.rd.updateJobs([job.id], { enabled: !job.enabled })
        }}
      >
        {job.enabled && <Check strokeWidth={3} />}
      </button>
      <div className="row-main">
        <div className="row-name">
          <span title={job.scenePath}>{job.sceneName}</span>
          {overrides > 0 && (
            <span className="over-tag" title="이 씬에만 적용된 설정이 있습니다">
              따로 설정
            </span>
          )}
        </div>
        <div className="row-meta">
          {busy ? (
            <span>씬 분석 중</span>
          ) : (
            <>
              <span className="v prog">
                {APP_LABEL[job.app]}
                {job.info.version ? ` ${job.info.version}` : ''}
              </span>
              <span className={`v${job.overrides.frameMode ? ' over' : ''}`}>
                {frameRange(job.frames)}, {num(job.frames.length)}프레임
              </span>
              <span className={`v${job.overrides.camera ? ' over' : ''}`}>{camera}</span>
              <span className={`v${job.overrides.format ? ' over' : ''}`}>{FORMAT_INFO[s.format]?.label}</span>
            </>
          )}
        </div>
        <FrameStrip job={job} />
        {issue && (
          <div className={`row-issue${issue.level === 'error' ? ' error' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <span className="msg">
              {issue.message}
              {issues.length > 1 ? ` 외 ${issues.length - 1}건` : ''}
            </span>
            {canFix && (
              <button className="link strong" onClick={() => applyFix(job, issue)}>
                {issue.fix!.label}
              </button>
            )}
            {issue.level !== 'error' && editable && (
              <button className="link" onClick={() => dismissIssue(job, issue)}>
                무시
              </button>
            )}
          </div>
        )}
        {failNote && (
          <div className="row-issue error" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <span className="msg">{job.status === 'partial' ? job.error : `렌더 실패: ${job.error}`}</span>
            <button className="link strong" onClick={() => window.rd.resetJobs([job.id], 'missing')}>
              빠진 프레임 다시 렌더
            </button>
          </div>
        )}
      </div>
      <div className="row-status">
        {st.kind === 'pct' ? (
          <div className="st-pct">
            {st.main}
            <small>%</small>
          </div>
        ) : st.kind === 'badge' ? (
          <span className={`badge ${st.tone}`}>{st.main}</span>
        ) : (
          <div className="st-text">{st.main}</div>
        )}
        {st.sub && <div className="st-sub">{st.sub}</div>}
      </div>
      <button
        className="btn ghost icon small row-more"
        aria-label="더 보기"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          if (!selected) select(job.id, 'single')
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
          openMenu({ x: r.right - 220, y: r.bottom + 4, jobId: job.id })
        }}
      >
        <MoreHorizontal />
      </button>
    </div>
  )
}
