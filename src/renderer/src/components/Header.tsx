import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FilePlus2, FolderPlus, Lock, Pause, Play, Plus, Settings2, Square } from 'lucide-react'
import { useUi } from '../store'
import { addScenes, openSettingsGuarded, pendingJobs, requestStart } from '../actions'

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 28 28" width={size} height={size}>
        <rect width={28} height={28} fill="#191919" />
        <rect x={7} y={8} width={3.6} height={12} rx={1.8} fill="#ffffff" />
        <rect x={12.2} y={8} width={3.6} height={12} rx={1.8} fill="#ffffff" />
        <rect x={17.4} y={8} width={3.6} height={12} rx={1.8} fill="#ffffff" opacity={0.4} />
      </svg>
    </span>
  )
}

export function Header() {
  const snap = useUi((s) => s.snap)!
  const { running, paused } = snap
  const ready = pendingJobs().length > 0
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const add = (kind: 'files' | 'folder') => {
    setMenu(false)
    void addScenes(kind)
  }

  return (
    <header className="header">
      <div className="brand">
        <Logo size={24} />
        <span className="brand-name">Render Farm</span>
      </div>
      <div className="add-wrap" ref={ref}>
        <button className="btn outline" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
          <Plus />
          Add scenes
          <ChevronDown className="chev" />
        </button>
        {menu && (
          <div className="menu" role="menu" style={{ position: 'absolute', top: 44, left: 0 }}>
            <button role="menuitem" onClick={() => add('files')}>
              <FilePlus2 />
              Add files…
            </button>
            <button role="menuitem" onClick={() => add('folder')}>
              <FolderPlus />
              Add folder…
            </button>
          </div>
        )}
      </div>
      <span className="spacer" />
      <button
        className="btn outline icon"
        onClick={openSettingsGuarded}
        title={snap.lock.locked ? 'Preferences (locked)' : 'Preferences'}
        aria-label="Preferences"
      >
        {snap.lock.locked ? <Lock /> : <Settings2 />}
      </button>
      <div className="transport">
        {running ? (
          <>
            {paused ? (
              <button className="btn outline" onClick={() => window.rd.resume()}>
                <Play />
                Resume
              </button>
            ) : (
              <button className="btn outline" onClick={() => window.rd.pause()} title="Pause after active scenes finish">
                <Pause />
                Pause
              </button>
            )}
            <button className="btn outline danger" onClick={() => window.rd.stop()} title="Stop now. Restart to resume remaining frames.">
              <Square />
              Stop
            </button>
          </>
        ) : (
          <button className="btn primary" disabled={!ready} onClick={() => requestStart()}>
            <Play fill="currentColor" />
            Start render
          </button>
        )}
      </div>
    </header>
  )
}
