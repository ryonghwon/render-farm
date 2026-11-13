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
      {ids.length > 1 && <div className="menu-label">{ids.length} scenes selected</div>}
      <button role="menuitem" onClick={run(() => openDetails(ids))}>
        <SlidersHorizontal />
        Scene settings…
      </button>
      <button role="menuitem" disabled={!job.outputDir} onClick={run(() => window.rd.openPath(job.outputDir!))}>
        <FolderOpen />
        Open output folder
      </button>
      <button role="menuitem" onClick={run(() => window.rd.showItem(job.scenePath))}>
        <FileSearch />
        Show scene file
      </button>
      <hr />
      <button role="menuitem" disabled={rendering || !hasMissing} onClick={run(() => window.rd.resetJobs(ids, 'missing'))}>
        <ListRestart />
        Render missing frames
      </button>
      <button role="menuitem" disabled={rendering} onClick={run(() => window.rd.resetJobs(ids, 'full'))}>
        <RefreshCcw />
        Render all frames again
      </button>
      <button
        role="menuitem"
        disabled={!jobs.some((j) => j.status === 'rendering' || (snap.running && (j.status === 'idle' || j.status === 'stopped')))}
        onClick={run(() => window.rd.skip(ids))}
      >
        <SkipForward />
        Skip
      </button>
      <hr />
      <button role="menuitem" onClick={run(() => window.rd.moveJobs(ids, 'top'))}>
        <ArrowUpToLine />
        Move to top
      </button>
      <button role="menuitem" onClick={run(() => window.rd.moveJobs(ids, 'bottom'))}>
        <ArrowDownToLine />
        Move to bottom
      </button>
      <button role="menuitem" onClick={run(() => window.rd.duplicateJobs(ids))}>
        <Copy />
        Duplicate
      </button>
      <button role="menuitem" disabled={rendering} onClick={run(() => window.rd.reprobe(ids, false))}>
        <ScanSearch />
        Inspect scene again
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
        Remove from queue
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
  const verb = action === 'shutdown' ? 'Shut down computer' : action === 'sleep' ? 'Put computer to sleep' : 'Quit Render Farm'
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
                <small>seconds</small>
              </span>
            </div>
          </div>
          <h2 id="cd-title">Render complete</h2>
          <p>
            {verb} in {c.countdown} seconds.
          </p>
          <p style={{ marginTop: 10 }}>
            Complete {snap.stats.jobsDone}
            {snap.stats.jobsFailed ? `; ${snap.stats.jobsFailed} need attention` : ''}
          </p>
        </div>
        <div className="modal-foot" style={{ justifyContent: 'center' }}>
          <button className="btn primary" autoFocus onClick={() => window.rd.cancelCountdown()}>
            Cancel
          </button>
          <button className="btn ghost" onClick={() => window.rd.completeNow()}>
            {ACTION_LABEL[action]} now
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
          <h2 id="pf-title">Preflight check</h2>
          <button className="btn ghost icon" aria-label="Close" onClick={() => setOpen(false)}>
            <X />
          </button>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ margin: '0 0 4px' }}>
            {flagged.length ? `${flagged.length} of ${jobs.length} scenes need attention.` : 'All scenes are ready to render.'}
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
                          Ignore
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            ))}
          </div>
          {blocked.length > 0 && (
            <p className="hint" style={{ color: 'var(--red)', margin: '8px 0 0' }}>
              Scenes with errors: {blocked.length}will be skipped.
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn primary" disabled={ok === 0} onClick={() => requestStart(true)}>
            {flagged.length ? `Start render (${ok})` : 'Start render'}
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
    toast(`Preset saved: ${n}`)
    setOpen(false)
  }
  const exists = snap.presets.some((p) => p.name === name.trim())
  return (
    <div className="modal-back" style={{ zIndex: 110 }} onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal narrow" role="dialog" aria-labelledby="ps-title">
        <div className="modal-head">
          <h2 id="ps-title">Save preset</h2>
        </div>
        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>
            Save the current output folder, file format, and advanced defaults as a preset.
          </p>
          <input
            className="input"
            autoFocus
            placeholder="Preset name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          {exists && (
            <div className="hint" style={{ marginTop: 6, color: 'var(--yellow)' }}>
              A preset with the same name will be replaced.
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
