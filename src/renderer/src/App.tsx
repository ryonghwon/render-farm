import { PinDialog, SettingsModal } from './components/Preferences'
import { useEffect, useRef, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { useUi } from './store'
import { Header } from './components/Header'
import { Queue } from './components/Queue'
import { LogPanel } from './components/LogPanel'
import { Rail } from './components/Rail'
import { SceneDialog } from './components/SceneDialog'
import { ContextMenu, CountdownModal, PreflightDialog, PresetDialog, Toasts } from './components/Overlays'
import { reportAdd } from './actions'

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

function modalOpen(): boolean {
  const s = useUi.getState()
  return s.settingsOpen || !!s.details || s.preflight || s.pinPrompt || s.presetDialog || !!s.snap?.completion.pendingAction
}

export function App() {
  const snap = useUi((s) => s.snap)
  const setSnap = useUi((s) => s.setSnap)
  const appendLogs = useUi((s) => s.appendLogs)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [drag, setDrag] = useState(false)
  const depth = useRef(0)

  useEffect(() => {
    void window.rd.getState().then(setSnap)
    void window.rd.appInfo().then(setInfo)
    const offState = window.rd.onState(setSnap)
    const offLog = window.rd.onLog(appendLogs)
    return () => {
      offState()
      offLog()
    }
  }, [setSnap, appendLogs])

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setDrag(true)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDrag(false)
    }
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDrag(false)
      const paths = Array.from(e.dataTransfer?.files ?? [])
        .map((f) => window.rd.pathForFile(f))
        .filter(Boolean)
      if (!paths.length) return
      reportAdd(await window.rd.addPaths(paths), true)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (typing(e) || modalOpen()) return
      const { snap, selected, setSelected, openDetails } = useUi.getState()
      if (!snap) return
      const sel = snap.jobs.filter((j) => selected.includes(j.id))
      const editable = sel.filter((j) => j.status !== 'rendering').map((j) => j.id)
      const mod = e.ctrlKey || e.metaKey
      if ((e.key === 'Delete' || e.key === 'Backspace') && editable.length) {
        e.preventDefault()
        void window.rd.removeJobs(editable)
        setSelected([])
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(snap.jobs.map((j) => j.id))
      } else if (mod && e.key.toLowerCase() === 'd' && selected.length) {
        e.preventDefault()
        void window.rd.duplicateJobs(selected)
      } else if (e.key === ' ' && editable.length) {
        e.preventDefault()
        void window.rd.updateJobs(editable, { enabled: !sel.every((j) => j.enabled) })
      } else if (e.key === 'Enter' && selected.length) {
        e.preventDefault()
        openDetails(selected)
      } else if (e.key === 'Escape') {
        setSelected([])
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && snap.jobs.length) {
        e.preventDefault()
        const order = snap.jobs.map((j) => j.id)
        const cur = selected.length ? order.indexOf(selected[selected.length - 1]) : -1
        const next = Math.min(order.length - 1, Math.max(0, cur + (e.key === 'ArrowDown' ? 1 : -1)))
        setSelected([order[next]])
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  if (!snap) return <div className="app" />

  return (
    <div className="app">
      <Header />
      <main className="main">
        <Queue dragActive={drag} />
        <LogPanel />
      </main>
      <Rail />
      <ContextMenu />
      <SceneDialog />
      <PreflightDialog />
      <CountdownModal />
      <SettingsModal info={info} />
      <PinDialog />
      <PresetDialog />
      <Toasts />
    </div>
  )
}
