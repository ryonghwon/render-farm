import { create } from 'zustand'
import type { LogLine, Snapshot } from '@shared/types'

export type ActivityTab = 'progress' | 'log'
export type LogFilter = 'summary' | 'issues' | 'all'

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

export interface MenuState {
  x: number
  y: number
  jobId: string
}

interface UiState {
  snap: Snapshot | null
  selected: string[]
  anchor: string | null
  activity: ActivityTab
  details: string[] | null
  preflight: boolean
  pinPrompt: boolean
  logSource: 'job' | 'system'
  logFilter: LogFilter
  showProgress: boolean
  logs: Record<string, LogLine[]>
  loadedLogs: Record<string, boolean>
  settingsOpen: boolean
  presetDialog: boolean
  toasts: Toast[]
  menu: MenuState | null
  setSnap: (s: Snapshot) => void
  select: (id: string, mode: 'single' | 'toggle' | 'range') => void
  setSelected: (ids: string[]) => void
  setActivity: (t: ActivityTab) => void
  openDetails: (ids: string[] | null) => void
  openPreflight: (v: boolean) => void
  openPin: (v: boolean) => void
  setLogSource: (s: 'job' | 'system') => void
  setLogFilter: (f: LogFilter) => void
  setShowProgress: (v: boolean) => void
  appendLogs: (lines: LogLine[]) => void
  setLog: (key: string, lines: LogLine[]) => void
  openSettings: (v: boolean) => void
  openPresetDialog: (v: boolean) => void
  toast: (text: string, tone?: 'info' | 'error') => void
  dismiss: (id: number) => void
  openMenu: (m: MenuState | null) => void
}

const CAP = 3000
let toastId = 0

export const SYSTEM_KEY = '__system'

export const useUi = create<UiState>((set, get) => ({
  snap: null,
  selected: [],
  anchor: null,
  activity: 'progress',
  details: null,
  preflight: false,
  pinPrompt: false,
  logSource: 'job',
  logFilter: 'summary',
  showProgress: false,
  logs: {},
  loadedLogs: {},
  settingsOpen: false,
  presetDialog: false,
  toasts: [],
  menu: null,
  setSnap: (snap) => {
    const ids = new Set(snap.jobs.map((j) => j.id))
    const selected = get().selected.filter((id) => ids.has(id))
    set({ snap, selected })
  },
  select: (id, mode) => {
    const { selected, anchor, snap } = get()
    if (mode === 'toggle') {
      set({ selected: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], anchor: id })
      return
    }
    if (mode === 'range' && anchor && snap) {
      const order = snap.jobs.map((j) => j.id)
      const a = order.indexOf(anchor)
      const b = order.indexOf(id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        set({ selected: order.slice(lo, hi + 1) })
        return
      }
    }
    set({ selected: [id], anchor: id })
  },
  setSelected: (ids) => set({ selected: ids, anchor: ids[ids.length - 1] ?? null }),
  setActivity: (activity) => set({ activity }),
  openDetails: (details) => set({ details }),
  openPreflight: (preflight) => set({ preflight }),
  openPin: (pinPrompt) => set({ pinPrompt }),
  setLogSource: (logSource) => set({ logSource }),
  setLogFilter: (logFilter) => set({ logFilter }),
  setShowProgress: (showProgress) => set({ showProgress }),
  appendLogs: (lines) => {
    const logs = { ...get().logs }
    for (const l of lines) {
      const key = l.jobId ?? SYSTEM_KEY
      const arr = logs[key] ? [...logs[key]] : []
      arr.push(l)
      if (arr.length > CAP) arr.splice(0, arr.length - CAP)
      logs[key] = arr
    }
    set({ logs })
  },
  setLog: (key, lines) => set({ logs: { ...get().logs, [key]: lines.slice(-CAP) }, loadedLogs: { ...get().loadedLogs, [key]: true } }),
  openSettings: (settingsOpen) => set({ settingsOpen }),
  openPresetDialog: (presetDialog) => set({ presetDialog }),
  toast: (text, tone = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, text, tone }] })
    setTimeout(() => get().dismiss(id), tone === 'error' ? 6000 : 3200)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  openMenu: (menu) => set({ menu })
}))
