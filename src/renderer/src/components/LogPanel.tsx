import { useEffect, useLayoutEffect, useRef } from 'react'
import { ClipboardCopy, FolderOpen, X } from 'lucide-react'
import { SYSTEM_KEY, useUi } from '../store'
import { Select } from './controls'
import { clock } from '../format'

export function LogPanel() {
  const snap = useUi((s) => s.snap)!
  const open = snap.app.logOpen
  const height = snap.app.logHeight
  if (!open) return null

  const startResize = (e: React.MouseEvent) => {
    const y0 = e.clientY
    const h0 = height
    let last = h0
    const move = (ev: MouseEvent) => {
      last = Math.min(Math.max(150, h0 + (y0 - ev.clientY)), window.innerHeight - 320)
      document.documentElement.style.setProperty('--log-h', `${last}px`)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      void window.rd.updateApp({ logHeight: Math.round(last) })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <section className="card logcard" style={{ height: `var(--log-h, ${Math.max(height, 180)}px)` }} aria-label="로그">
      <div className="log-resize" onMouseDown={startResize} role="separator" aria-orientation="horizontal" />
      <div className="log-head">
        <h3>로그</h3>
        <LogTools />
        <span className="spacer" />
        <button
          className="btn ghost icon small"
          aria-label="로그 닫기"
          title="로그 닫기"
          onClick={() => window.rd.updateApp({ logOpen: false })}
        >
          <X />
        </button>
      </div>
      <LogView />
    </section>
  )
}

function useLogKey(): { key: string; jobName: string | null } {
  const snap = useUi((s) => s.snap)!
  const selected = useUi((s) => s.selected)
  const source = useUi((s) => s.logSource)
  const job = source === 'job' && selected.length ? snap.jobs.find((j) => j.id === selected[selected.length - 1]) : undefined
  return { key: job ? job.id : SYSTEM_KEY, jobName: job ? job.sceneName : null }
}

function useFilteredLines() {
  const { key } = useLogKey()
  const logs = useUi((s) => s.logs)
  const filter = useUi((s) => s.logFilter)
  const all = logs[key] ?? []
  return all.filter((l) => {
    if (l.level === 'progress') return false
    if (filter === 'all') return true
    if (!l.raw) return l.level !== 'info'
    return filter === 'issues' && (l.level === 'warn' || l.level === 'error')
  })
}

function LogTools() {
  const source = useUi((s) => s.logSource)
  const setSource = useUi((s) => s.setLogSource)
  const filter = useUi((s) => s.logFilter)
  const setFilter = useUi((s) => s.setLogFilter)
  const toast = useUi((s) => s.toast)
  const { key, jobName } = useLogKey()
  const lines = useFilteredLines()
  return (
    <div className="log-tools">
      <Select
        className="mini"
        value={source}
        options={[
          { value: 'job', label: jobName ? `씬: ${jobName}` : '선택한 씬' },
          { value: 'system', label: '전체' }
        ]}
        onChange={setSource}
        ariaLabel="로그 대상"
      />
      <Select
        className="mini"
        value={filter}
        options={[
          { value: 'summary', label: '요약' },
          { value: 'issues', label: 'Maya 경고 포함' },
          { value: 'all', label: 'Maya 전체' }
        ]}
        onChange={setFilter}
        ariaLabel="로그 보기"
      />
      <button
        className="btn ghost small icon"
        title="표시된 로그 복사"
        aria-label="로그 복사"
        onClick={async () => {
          await navigator.clipboard.writeText(lines.map((l) => `${clock(l.t)} ${l.text}`).join('\n'))
          toast(`로그 ${lines.length}줄을 복사했습니다.`)
        }}
      >
        <ClipboardCopy />
      </button>
      <button
        className="btn ghost small icon"
        title="로그 폴더 열기"
        aria-label="로그 폴더 열기"
        onClick={() => window.rd.openLogs(key === SYSTEM_KEY ? null : key)}
      >
        <FolderOpen />
      </button>
    </div>
  )
}

function LogView() {
  const { key } = useLogKey()
  const loaded = useUi((s) => s.loadedLogs)
  const setLog = useUi((s) => s.setLog)
  const source = useUi((s) => s.logSource)
  const selected = useUi((s) => s.selected)
  const lines = useFilteredLines().slice(-1500)
  const bodyRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    if (loaded[key]) return
    void window.rd.getLog(key === SYSTEM_KEY ? null : key).then((l) => setLog(key, l))
  }, [key, loaded, setLog])
  useLayoutEffect(() => {
    const el = bodyRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })
  return (
    <div
      className="log-body"
      ref={bodyRef}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
    >
      {lines.length === 0 && (
        <div className="log-empty">{source === 'job' && !selected.length ? '씬을 선택하면 해당 로그가 표시됩니다.' : '로그 없음'}</div>
      )}
      {lines.map((l, i) => (
        <div key={`${l.t}-${i}`} className={`log-line ${l.level}`}>
          <time>{clock(l.t)}</time>
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  )
}
