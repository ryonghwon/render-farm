import { useEffect, useState } from 'react'
import { Folder, FolderOpen, Lock, MoonStar } from 'lucide-react'
import type { FormatKey, Job, PreviewInfo } from '@shared/types'
import { useUi } from '../store'
import { ACTION_LABEL, FORMAT_INFO, duration, num, waitLabel } from '../format'

export function Rail() {
  return (
    <aside className="rail" aria-label="Render status">
      <ProgressCard />
      <OutputCard />
      <NowCard />
    </aside>
  )
}

function ProgressCard() {
  const snap = useUi((s) => s.snap)!
  const { stats, running, paused, app } = snap
  const armed = app.completionAction !== 'none'
  const kind = app.completionKind ?? 'shutdown'
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  const allDone = !running && stats.jobsTotal > 0 && stats.jobsDone === stats.jobsTotal
  const started = running || stats.doneFrames > 0
  const pct = Math.floor(stats.progress * 100)
  const state = running ? (paused ? 'Paused' : 'Rendering') : allDone ? 'Complete' : stats.jobsTotal ? 'Ready' : 'Queued'
  const tone = running ? (paused ? 'paused' : 'on') : allDone ? 'done' : ''
  let timeLabel = 'Time remaining'
  let timeValue = '-'
  if (running) {
    timeValue = paused ? 'Pausing after active scenes' : stats.etaMs ? duration(stats.etaMs, true) : 'Calculating'
    if (!paused && stats.etaMs && stats.etaEstimated) timeLabel = 'Estimated time remaining'
  } else if (allDone) {
    const ran = snap.jobs.filter((j) => j.enabled && j.startedAt && j.finishedAt)
    if (ran.length) {
      timeLabel = 'Elapsed'
      timeValue = duration(Math.max(...ran.map((j) => j.finishedAt!)) - Math.min(...ran.map((j) => j.startedAt!)))
    }
  } else if (stats.etaMs) {
    timeLabel = stats.etaEstimated ? 'Estimated duration' : 'Estimated time'
    timeValue = duration(stats.etaMs, true)
  }
  return (
    <section className="card hero" aria-label="Overall progress">
      <div className="hero-top">
        <span className={`state ${tone}`}>
          <i />
          {state}
        </span>
        {snap.awake && (
          <span className="awake" title="Keep the computer awake while rendering">
            <MoonStar />
          </span>
        )}
      </div>
      <div className="big">
        <span>{started ? pct : num(stats.totalFrames)}</span>
        <small>{started ? '%' : 'frames'}</small>
      </div>
      <div className="hero-cap">
        {started
          ? `${num(stats.doneFrames)} / ${num(stats.totalFrames)} frames`
          : stats.jobsTotal
            ? `${stats.jobsTotal} scenes to render`
            : 'Queue is empty'}
      </div>
      <div className={`gbar${allDone ? ' done' : ''}`}>
        <i style={{ width: `${started ? stats.progress * 100 : 0}%` }} />
      </div>
      <div className="minis">
        <div className="mini">
          <span className="lbl">Completed scenes</span>
          <b>
            {stats.jobsDone}
            <small> / {stats.jobsTotal}</small>
          </b>
        </div>
        <div className="mini">
          <span className="lbl">{timeLabel}</span>
          <b className={timeValue.length > 8 ? 'sm' : ''}>{timeValue}</b>
        </div>
      </div>
      {!running && stats.jobsFailed > 0 && <div className="hero-warn">Scenes needing attention {stats.jobsFailed}</div>}
      <button
        className={`cbox${armed ? ' on' : ''}`}
        role="switch"
        aria-checked={armed}
        title={`Runs ${app.countdownSeconds} seconds after the queue finishes. You can cancel during the countdown.`}
        onClick={() => window.rd.setCompletion(armed ? 'none' : kind)}
      >
        <span className="cb-text">
          <b>On completion: {ACTION_LABEL[kind]}</b>
          <small>{armed ? `Runs ${app.countdownSeconds} seconds after completion` : 'Disabled'}</small>
        </span>
        <span className={`switch${armed ? ' on' : ''}`} />
      </button>
    </section>
  )
}

const FORMATS: FormatKey[] = ['exr', 'png', 'jpg', 'tif', 'scene']

function splitPath(p: string): { name: string; parent: string } {
  const parts = p.split(/[\\/]/).filter(Boolean)
  const name = parts.pop() ?? p
  const sep = p.includes('\\') ? '\\' : '/'
  const parent = p.slice(0, Math.max(0, p.length - name.length)).replace(/[\\/]+$/, '') || sep
  return { name, parent }
}

function OutputCard() {
  const snap = useUi((s) => s.snap)!
  const g = snap.global
  const locked = snap.lock.locked
  const pick = async () => {
    if (locked) return
    const p = await window.rd.pickOutputDir(g.outputRoot)
    if (p) void window.rd.updateGlobal({ outputRoot: p })
  }
  const sp = g.outputRoot ? splitPath(g.outputRoot) : null
  const sep = g.outputRoot.includes('\\') ? '\\' : '/'
  const sceneFolder = g.folderPattern.includes('{scene}')
  const nested = sp && sceneFolder && snap.jobs.some((j) => j.sceneName.toLowerCase() === sp.name.toLowerCase())
  return (
    <section className="card" aria-label="Output">
      <div className="card-head">
        <h3>Output</h3>
        {locked && (
          <span className="lock-note" title="These settings are locked by the administrator">
            <Lock />
            Locked settings
          </span>
        )}
      </div>
      <div className="flabel">Output folder</div>
      <div className="pathrow">
        <button
          className={`pathbtn${sp ? '' : ' empty'}`}
          onClick={pick}
          disabled={locked}
          title={g.outputRoot ? `${g.outputRoot}\nClick to change` : 'Choose output folder'}
        >
          <Folder />
          {sp ? (
            <span className="pb-text">
              <span className="pb-parent">
                <bdi>{sp.parent.endsWith(sep) ? sp.parent : `${sp.parent}${sep}`}</bdi>
              </span>
              <span className="pb-name">{sp.name}</span>
            </span>
          ) : (
            <span className="pb-text">
              <span className="pb-name">Choose output folder</span>
            </span>
          )}
        </button>
        {g.outputRoot && (
          <button
            className="btn outline icon"
            title="Open folder"
            aria-label="Open output folder"
            onClick={() => window.rd.openPath(g.outputRoot)}
          >
            <FolderOpen />
          </button>
        )}
      </div>
      {nested ? (
        <p className="hint path-note warn">
          The output folder already uses the scene name. This will create a second folder with the same name.
          {!locked && (
            <button className="link strong" onClick={() => window.rd.updateGlobal({ outputRoot: sp!.parent })}>
              Use parent folder
            </button>
          )}
        </p>
      ) : (
        sp && (
          <p className="hint path-note">
            {sceneFolder
              ? 'Creates a separate folder for each scene.'
              : g.folderPattern
                ? `Creates output folders using ${g.folderPattern}.`
                : 'Saves directly to the output folder.'}
          </p>
        )
      )}
      <div className="flabel">File format</div>
      <div className="chips" role="radiogroup" aria-label="File format">
        {FORMATS.map((f) => (
          <button
            key={f}
            role="radio"
            aria-checked={g.format === f}
            className={`chip${g.format === f ? ' on' : ''}`}
            disabled={locked && g.format !== f}
            onClick={() => !locked && window.rd.updateGlobal({ format: f })}
          >
            {FORMAT_INFO[f].label}
          </button>
        ))}
      </div>
      <p className="hint fmt-desc" title={FORMAT_INFO[g.format]?.desc}>
        {FORMAT_INFO[g.format]?.short}
      </p>
    </section>
  )
}

function NowCard() {
  const snap = useUi((s) => s.snap)!
  const active = snap.jobs.filter((j) => j.status === 'rendering')
  const recent = [...snap.jobs]
    .filter((j) => j.finishedAt && (j.status === 'done' || j.status === 'partial'))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]
  const list = active.length ? active : recent ? [recent] : []
  return (
    <section className="card now" aria-label="Preview">
      <div className="card-head">
        <h3>{active.length ? 'Rendering' : recent ? 'Latest frame' : 'Preview'}</h3>
        {active.length > 1 && <span className="count">{active.length}concurrent tasks</span>}
      </div>
      {list.length === 0 ? (
        <div className="now-empty">
          <div className="thumb ph" />
          <p className="hint">The latest frame appears after rendering starts.</p>
        </div>
      ) : (
        <div className={`now-list${list.length > 1 ? ' compact' : ''}`}>
          {list.map((j) => (
            <NowItem key={j.id} job={j} recent={!active.length} />
          ))}
        </div>
      )}
    </section>
  )
}

function NowItem({ job, recent }: { job: Job; recent: boolean }) {
  const [p, setP] = useState<PreviewInfo | null>(null)
  const key = `${job.lastFrame?.path ?? ''}|${job.doneFrames.length}|${job.status}`
  useEffect(() => {
    let alive = true
    void window.rd.getPreview(job.id).then((r) => alive && setP(r))
    return () => {
      alive = false
    }
  }, [job.id, key])
  const total = job.frames.length
  const done = Math.min(job.doneFrames.length, total)
  const pct = total ? (done / total) * 100 : 0
  const cur = job.tasks.find((t) => t.status === 'running')
  return (
    <div className="now-item">
      <div className="thumb">
        {p?.dataUrl ? (
          <img src={p.dataUrl} alt={`${job.sceneName}, frame ${p.frame}`} />
        ) : (
          <span>{p?.message ?? 'Waiting for first frame'}</span>
        )}
      </div>
      <div className="now-info">
        <div className="now-name">{job.sceneName}</div>
        <div className={`gbar thin${recent && job.status === 'done' ? ' done' : ''}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="now-foot">
          <span>
            {recent
              ? job.status === 'done'
                ? `Complete in ${duration(job.elapsedMs)}`
                : `${num(job.missingFrames.length)} missing frames`
              : (waitLabel(job) ?? (cur?.currentFrame != null ? `Frame ${cur.currentFrame}` : 'Opening scene'))}
          </span>
          <span>
            {num(done)} / {num(total)}
          </span>
        </div>
      </div>
    </div>
  )
}
