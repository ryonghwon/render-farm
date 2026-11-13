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
    <section className="card queue" aria-label="Render queue">
      <div className="queue-head">
        {selJobs.length ? (
          <div className="sel">
            <span className="sel-count">{selJobs.length} selected</span>
            <button className="btn small" onClick={() => openDetails(selected)}>
              Scene settings
            </button>
            <button
              className="btn small"
              disabled={anyRendering}
              onClick={() => {
                void window.rd.removeJobs(selected)
                setSelected([])
              }}
            >
              Remove from queue
            </button>
            <button className="link" onClick={() => setSelected([])}>
              Clear selection
            </button>
          </div>
        ) : (
          <>
            <h2>Render queue</h2>
            {snap.jobs.length > 0 && (
              <span className="q-count">
                Scenes: {enabled.length} · {num(totalFrames)} frames
              </span>
            )}
          </>
        )}
        <span className="spacer" />
        {hasFinished && !selJobs.length && (
          <button className="btn small ghost" onClick={() => window.rd.clearFinished()}>
            Clear finished scenes
          </button>
        )}
        <button
          className={`btn small${logOpen ? ' on' : ' outline'}`}
          aria-pressed={logOpen}
          onClick={() => window.rd.updateApp({ logOpen: !logOpen })}
        >
          <ScrollText />
          Log
        </button>
      </div>
      {snap.jobs.length === 0 ? (
        <div className="empty">
          <div className="empty-inner">
            <div className="empty-icon" aria-hidden>
              <Upload />
            </div>
            <h2>Your render queue is empty</h2>
            <p>Drop Maya (.ma, .mb) or Blender (.blend) files, or a folder, to add scenes.</p>
            <div className="actions">
              <button className="btn primary" onClick={() => addScenes('files')}>
                <FilePlus2 />
                Add files…
              </button>
              <button className="btn outline" onClick={() => addScenes('folder')}>
                <FolderPlus />
                Add folder…
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
            Drop to add to queue
            <small>.ma, .mb, .blend files or folders</small>
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
  if (job.info.state === 'pending' || job.info.state === 'running') return { kind: 'text', main: 'Inspecting' }
  if (!job.enabled && job.status === 'idle') return { kind: 'text', main: 'Excluded' }
  switch (job.status) {
    case 'rendering': {
      const cur = job.tasks.find((t) => t.status === 'running')
      const sub =
        waitLabel(job) ??
        (job.etaMs ? `Remaining: ${duration(job.etaMs, true)}` : cur?.currentFrame != null ? `Frame ${cur.currentFrame}` : 'Opening scene')
      return { kind: 'pct', main: `${pct}`, sub }
    }
    case 'done':
      return { kind: 'badge', main: 'Complete', tone: 'done', sub: duration(job.elapsedMs) }
    case 'partial':
      return { kind: 'badge', main: 'Missing frames', tone: 'warn', sub: `${num(job.missingFrames.length)}` }
    case 'failed':
      return { kind: 'badge', main: 'Failed', tone: 'failed' }
    case 'stopped':
      return { kind: 'badge', main: `Stopped at ${pct}%`, tone: 'plain', sub: 'Ready to resume' }
    case 'skipped':
      return { kind: 'text', main: 'Skipped' }
    default:
      return { kind: 'text', main: 'Queued' }
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
  const camera = s.camera || renderCams.join(', ') || 'No camera assigned'
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

  const canFix =
    issue?.fix &&
    editable &&
    (!locked ||
      !issue.fix.patch ||
      Object.keys(issue.fix.patch).every((k) => ['frameMode', 'start', 'end', 'step', 'camera', 'layers'].includes(k)))

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
      aria-roledescription="Scene"
    >
      <button
        className={`check${job.enabled ? ' on' : ''}`}
        aria-label={job.enabled ? 'Exclude from rendering' : 'Include in rendering'}
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
            <span className="over-tag" title="This scene has custom settings">
              Overrides
            </span>
          )}
        </div>
        <div className="row-meta">
          {busy ? (
            <span>Inspecting scene</span>
          ) : (
            <>
              <span className="v prog">
                {APP_LABEL[job.app]}
                {job.info.version ? ` ${job.info.version}` : ''}
              </span>
              <span className={`v${job.overrides.frameMode ? ' over' : ''}`}>
                {frameRange(job.frames)}, {num(job.frames.length)} frames
              </span>
              <span className={`v${job.overrides.camera ? ' over' : ''}`}>{camera}</span>
              <span className={`v${job.overrides.format ? ' over' : ''}`}>{FORMAT_INFO[s.format]?.label}</span>
            </>
          )}
        </div>
        <FrameStrip job={job} />
        {issue && (
          <div
            className={`row-issue${issue.level === 'error' ? ' error' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="msg">
              {issue.message}
              {issues.length > 1 ? ` and ${issues.length - 1} more` : ''}
            </span>
            {canFix && (
              <button className="link strong" onClick={() => applyFix(job, issue)}>
                {issue.fix!.label}
              </button>
            )}
            {issue.level !== 'error' && editable && (
              <button className="link" onClick={() => dismissIssue(job, issue)}>
                Ignore
              </button>
            )}
          </div>
        )}
        {failNote && (
          <div className="row-issue error" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            <span className="msg">{job.status === 'partial' ? job.error : `Render failed: ${job.error}`}</span>
            <button className="link strong" onClick={() => window.rd.resetJobs([job.id], 'missing')}>
              Render missing frames
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
        aria-label="More options"
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
