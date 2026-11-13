import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  FileSearch,
  FolderOpen,
  ListRestart,
  RefreshCcw,
  ScanSearch,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { applyFix, dismissIssue, pendingJobs, requestStart } from '../actions'
import { ACTION_LABEL } from '../format'
import { useUi } from '../store'

export function ContextMenu() {
  const menu = useUi((s) => s.menu)
  const openMenu = useUi((s) => s.openMenu)
  const openDetails = useUi((s) => s.openDetails)
  const snap = useUi((s) => s.snap)
  const selected = useUi((s) => s.selected)
  const setSelected = useUi((s) => s.setSelected)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8))
    })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) openMenu(null)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && openMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', key)
      setPos(null)
    }
  }, [menu, openMenu])

  if (!menu || !snap) return null
  const job = snap.jobs.find((j) => j.id === menu.jobId)
  if (!job) return null
  const ids = selected.includes(job.id) ? selected : [job.id]
  const jobs = snap.jobs.filter((j) => ids.includes(j.id))
  const rendering = jobs.some((j) => j.status === 'rendering')
  const hasMissing = jobs.some((j) => j.status === 'partial' || j.status === 'failed' || j.status === 'stopped')
  const run = (fn: () => unknown) => () => {
    void fn()
    openMenu(null)
  }

  return (
    <div
      className="menu"
      ref={ref}
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      role="menu"
    >
      {ids.length > 1 && <div className="menu-label">씬 {ids.length}개 선택됨</div>}
      <button role="menuitem" onClick={run(() => openDetails(ids))}>
        <SlidersHorizontal />씬 설정…
      </button>
      <button role="menuitem" disabled={!job.outputDir} onClick={run(() => window.rd.openPath(job.outputDir!))}>
        <FolderOpen />
        저장 폴더 열기
      </button>
      <button role="menuitem" onClick={run(() => window.rd.showItem(job.scenePath))}>
        <FileSearch />씬 파일 위치 열기
      </button>
      <hr />
      <button role="menuitem" disabled={rendering || !hasMissing} onClick={run(() => window.rd.resetJobs(ids, 'missing'))}>
        <ListRestart />
        빠진 프레임 다시 렌더
      </button>
      <button role="menuitem" disabled={rendering} onClick={run(() => window.rd.resetJobs(ids, 'full'))}>
        <RefreshCcw />
        전체 다시 렌더
      </button>
      <button
        role="menuitem"
        disabled={!jobs.some((j) => j.status === 'rendering' || (snap.running && (j.status === 'idle' || j.status === 'stopped')))}
        onClick={run(() => window.rd.skip(ids))}
      >
        <SkipForward />
        건너뛰기
      </button>
      <hr />
      <button role="menuitem" onClick={run(() => window.rd.moveJobs(ids, 'top'))}>
        <ArrowUpToLine />맨 위로 이동
      </button>
      <button role="menuitem" onClick={run(() => window.rd.moveJobs(ids, 'bottom'))}>
        <ArrowDownToLine />맨 아래로 이동
      </button>
      <button role="menuitem" onClick={run(() => window.rd.duplicateJobs(ids))}>
        <Copy />
        복제
      </button>
      <button role="menuitem" disabled={rendering} onClick={run(() => window.rd.reprobe(ids, false))}>
        <ScanSearch />씬 다시 분석
      </button>
      <hr />
      <button
        role="menuitem"
        className="danger"
        disabled={rendering}
        onClick={run(() => {
          setSelected([])
          return window.rd.removeJobs(ids)
        })}
      >
        <Trash2 />
        목록에서 빼기
      </button>
    </div>
  )
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismiss)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function CountdownModal() {
  const snap = useUi((s) => s.snap)!
  const c = snap.completion
  if (c.countdown === null || !c.pendingAction) return null
  const action = c.pendingAction
  const verb = action === 'shutdown' ? 'PC를 끕니다' : action === 'sleep' ? '절전 모드로 전환합니다' : 'Render Farm을 닫습니다'
  return (
    <div className="modal-back">
      <div className="modal narrow" role="alertdialog" aria-labelledby="cd-title">
        <div className="countdown">
          <div
            className={`ring ${action}`}
            style={{ ['--p' as string]: Math.max(0, Math.min(1, c.countdown / Math.max(1, snap.app.countdownSeconds))) }}
          >
            <div className="disc" aria-live="assertive">
              <span className="cd-num">
                <span className="digits">{c.countdown}</span>
                <small>초</small>
              </span>
            </div>
          </div>
          <h2 id="cd-title">렌더 완료</h2>
          <p>
            {c.countdown}초 후 {verb}.
          </p>
          <p style={{ marginTop: 10 }}>
            완료 {snap.stats.jobsDone}개{snap.stats.jobsFailed ? `, 확인 필요 ${snap.stats.jobsFailed}개` : ''}
          </p>
        </div>
        <div className="modal-foot" style={{ justifyContent: 'center' }}>
          <button className="btn primary" autoFocus onClick={() => window.rd.cancelCountdown()}>
            취소
          </button>
          <button className="btn ghost" onClick={() => window.rd.completeNow()}>
            지금 {ACTION_LABEL[action]}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PreflightDialog() {
  const open = useUi((s) => s.preflight)
  const setOpen = useUi((s) => s.openPreflight)
  const snap = useUi((s) => s.snap)
  useEffect(() => {
    if (!open) return
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [open, setOpen])
  if (!open || !snap) return null
  const jobs = pendingJobs()
  const flagged = jobs.filter((j) => j.issues.some((i) => i.level === 'error' || i.level === 'warn'))
  const blocked = jobs.filter((j) => j.issues.some((i) => i.level === 'error'))
  const ok = jobs.length - blocked.length
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal" role="dialog" aria-labelledby="pf-title" style={{ width: 'min(640px, calc(100vw - 48px))' }}>
        <div className="modal-head">
          <h2 id="pf-title">렌더 전 점검</h2>
          <button className="btn ghost icon" aria-label="닫기" onClick={() => setOpen(false)}>
            <X />
          </button>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ margin: '0 0 4px' }}>
            {flagged.length ? `씬 ${jobs.length}개 중 ${flagged.length}개에 확인 사항이 있습니다.` : '모든 씬이 렌더 준비 상태입니다.'}
          </p>
          <div>
            {flagged.map((j) => (
              <div key={j.id} className="issue-group">
                <h4>{j.sceneName}</h4>
                {j.issues
                  .filter((i) => i.level !== 'info')
                  .map((is) => (
                    <div key={is.code} className={`issue-item${is.level === 'error' ? ' error' : ''}`}>
                      <span className="msg">{is.message}</span>
                      {is.fix && (
                        <button
                          className="link"
                          onClick={() => {
                            if (is.fix?.action === 'details') setOpen(false)
                            applyFix(j, is)
                          }}
                        >
                          {is.fix.label}
                        </button>
                      )}
                      {is.level !== 'error' && (
                        <button className="link quiet" onClick={() => dismissIssue(j, is)}>
                          무시
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </div>
          {blocked.length > 0 && (
            <p className="hint" style={{ color: 'var(--red)', margin: '8px 0 0' }}>
              오류가 있는 씬 {blocked.length}개는 제외하고 진행합니다.
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)}>
            취소
          </button>
          <button className="btn primary" disabled={ok === 0} onClick={() => requestStart(true)}>
            {flagged.length ? `그대로 시작 (${ok})` : '렌더 시작'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PresetDialog() {
  const open = useUi((s) => s.presetDialog)
  const setOpen = useUi((s) => s.openPresetDialog)
  const toast = useUi((s) => s.toast)
  const snap = useUi((s) => s.snap)!
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])
  if (!open) return null
  const save = async () => {
    const n = name.trim()
    if (!n) return
    await window.rd.savePreset(n)
    toast(`프리셋을 저장했습니다: ${n}`)
    setOpen(false)
  }
  const exists = snap.presets.some((p) => p.name === name.trim())
  return (
    <div className="modal-back" style={{ zIndex: 110 }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal narrow" role="dialog" aria-labelledby="ps-title">
        <div className="modal-head">
          <h2 id="ps-title">프리셋 저장</h2>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>
            현재 저장 폴더, 파일 형식, 고급 기본값을 프리셋으로 저장합니다.
          </p>
          <input
            className="input"
            autoFocus
            placeholder="프리셋 이름"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          {exists && (
            <div className="hint" style={{ marginTop: 6, color: 'var(--yellow)' }}>
              같은 이름의 프리셋을 덮어씁니다.
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)}>
            취소
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>
            저장
          </button>
        </div>
      </div>
    </div>
  )
}
