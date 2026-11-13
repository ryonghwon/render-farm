import { useEffect, useState } from 'react'
import { Folder, FolderOpen, Lock, MoonStar } from 'lucide-react'
import type { FormatKey, Job, PreviewInfo } from '@shared/types'
import { useUi } from '../store'
import { ACTION_LABEL, FORMAT_INFO, duration, num, waitLabel } from '../format'

export function Rail() {
  return (
    <aside className="rail" aria-label="렌더 현황">
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
  const state = running ? (paused ? '잠시 멈춤' : '렌더 중') : allDone ? '완료' : stats.jobsTotal ? '준비됨' : '대기'
  const tone = running ? (paused ? 'paused' : 'on') : allDone ? 'done' : ''
  let timeLabel = '남은 시간'
  let timeValue = '-'
  if (running) {
    timeValue = paused ? '진행 중인 씬 후 멈춤' : stats.etaMs ? duration(stats.etaMs, true) : '계산 중'
    if (!paused && stats.etaMs && stats.etaEstimated) timeLabel = '남은 시간(추정)'
  } else if (allDone) {
    const ran = snap.jobs.filter((j) => j.enabled && j.startedAt && j.finishedAt)
    if (ran.length) {
      timeLabel = '걸린 시간'
      timeValue = duration(Math.max(...ran.map((j) => j.finishedAt!)) - Math.min(...ran.map((j) => j.startedAt!)))
    }
  } else if (stats.etaMs) {
    timeLabel = stats.etaEstimated ? '예상 시간(추정)' : '예상 시간'
    timeValue = duration(stats.etaMs, true)
  }
  return (
    <section className="card hero" aria-label="전체 진행">
      <div className="hero-top">
        <span className={`state ${tone}`}>
          <i />
          {state}
        </span>
        {snap.awake && (
          <span className="awake" title="렌더 중 절전 모드 진입 방지">
            <MoonStar />
          </span>
        )}
      </div>
      <div className="big">
        <span>{started ? pct : num(stats.totalFrames)}</span>
        <small>{started ? '%' : '프레임'}</small>
      </div>
      <div className="hero-cap">{started ? `${num(stats.doneFrames)} / ${num(stats.totalFrames)}프레임` : stats.jobsTotal ? `렌더 대상 씬 ${stats.jobsTotal}개` : '렌더 목록 비어 있음'}</div>
      <div className={`gbar${allDone ? ' done' : ''}`}>
        <i style={{ width: `${started ? stats.progress * 100 : 0}%` }} />
      </div>
      <div className="minis">
        <div className="mini">
          <span className="lbl">끝난 씬</span>
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
      {!running && stats.jobsFailed > 0 && <div className="hero-warn">확인 필요 씬 {stats.jobsFailed}개</div>}
      <button
        className={`cbox${armed ? ' on' : ''}`}
        role="switch"
        aria-checked={armed}
        title={`모든 씬이 끝나면 ${app.countdownSeconds}초 카운트다운 후 실행합니다. 카운트다운 중 취소할 수 있습니다.`}
        onClick={() => window.rd.setCompletion(armed ? 'none' : kind)}
      >
        <span className="cb-text">
          <b>끝나면 {ACTION_LABEL[kind]}</b>
          <small>{armed ? `모두 끝나면 ${app.countdownSeconds}초 뒤 실행` : '사용 안 함'}</small>
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
    <section className="card" aria-label="저장">
      <div className="card-head">
        <h3>저장</h3>
        {locked && (
          <span className="lock-note" title="관리자가 고정한 설정입니다">
            <Lock />
            관리자 설정
          </span>
        )}
      </div>
      <div className="flabel">저장 폴더</div>
      <div className="pathrow">
        <button className={`pathbtn${sp ? '' : ' empty'}`} onClick={pick} disabled={locked} title={g.outputRoot ? `${g.outputRoot}\n클릭하여 변경` : '저장 폴더 선택'}>
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
              <span className="pb-name">저장 폴더 선택</span>
            </span>
          )}
        </button>
        {g.outputRoot && (
          <button className="btn outline icon" title="폴더 열기" aria-label="저장 폴더 열기" onClick={() => window.rd.openPath(g.outputRoot)}>
            <FolderOpen />
          </button>
        )}
      </div>
      {nested ? (
        <p className="hint path-note warn">
          씬 이름 폴더를 저장 폴더로 지정해 같은 이름의 폴더가 한 번 더 생깁니다.
          {!locked && (
            <button className="link strong" onClick={() => window.rd.updateGlobal({ outputRoot: sp!.parent })}>
              상위 폴더로 변경
            </button>
          )}
        </p>
      ) : (
        sp && <p className="hint path-note">{sceneFolder ? '씬마다 씬 이름 폴더를 만들어 저장합니다.' : g.folderPattern ? `${g.folderPattern} 폴더를 만들어 저장합니다.` : '폴더를 따로 만들지 않고 바로 저장합니다.'}</p>
      )}
      <div className="flabel">파일 형식</div>
      <div className="chips" role="radiogroup" aria-label="파일 형식">
        {FORMATS.map((f) => (
          <button key={f} role="radio" aria-checked={g.format === f} className={`chip${g.format === f ? ' on' : ''}`} disabled={locked && g.format !== f} onClick={() => !locked && window.rd.updateGlobal({ format: f })}>
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
  const recent = [...snap.jobs].filter((j) => j.finishedAt && (j.status === 'done' || j.status === 'partial')).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0]
  const list = active.length ? active : recent ? [recent] : []
  return (
    <section className="card now" aria-label="미리보기">
      <div className="card-head">
        <h3>{active.length ? '렌더 중' : recent ? '최근 완료' : '미리보기'}</h3>
        {active.length > 1 && <span className="count">{active.length}개 동시 실행</span>}
      </div>
      {list.length === 0 ? (
        <div className="now-empty">
          <div className="thumb ph" />
          <p className="hint">렌더 시작 후 최근 프레임이 표시됩니다.</p>
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
      <div className="thumb">{p?.dataUrl ? <img src={p.dataUrl} alt={`${job.sceneName} 프레임 ${p.frame}`} /> : <span>{p?.message ?? '첫 프레임 대기 중'}</span>}</div>
      <div className="now-info">
        <div className="now-name">{job.sceneName}</div>
        <div className={`gbar thin${recent && job.status === 'done' ? ' done' : ''}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="now-foot">
          <span>{recent ? (job.status === 'done' ? `완료, ${duration(job.elapsedMs)}` : `빠진 프레임 ${num(job.missingFrames.length)}개`) : waitLabel(job) ?? (cur?.currentFrame != null ? `프레임 ${cur.currentFrame}` : '씬 여는 중')}</span>
          <span>
            {num(done)} / {num(total)}
          </span>
        </div>
      </div>
    </div>
  )
}
