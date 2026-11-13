import type { Issue, Job } from '@shared/types'
import { useUi } from './store'

export function pendingJobs(): Job[] {
  const snap = useUi.getState().snap
  if (!snap) return []
  return snap.jobs.filter((j) => j.enabled && (j.status === 'idle' || j.status === 'stopped'))
}

export async function requestStart(force = false): Promise<void> {
  const { openPreflight, toast } = useUi.getState()
  const jobs = pendingJobs()
  if (!jobs.length) {
    toast('No scenes selected for rendering.', 'error')
    return
  }
  const needs = jobs.filter((j) => j.issues.some((i) => i.level === 'error' || i.level === 'warn'))
  if (needs.length && !force) {
    openPreflight(true)
    return
  }
  openPreflight(false)
  await window.rd.start()
}

export async function addScenes(kind: 'files' | 'folder'): Promise<void> {
  const r = kind === 'files' ? await window.rd.pickFiles() : await window.rd.pickFolder()
  reportAdd(r)
}

export function reportAdd(r: { added: number; skipped: number }, empty = false): void {
  const { toast } = useUi.getState()
  if (r.added) toast(`Added ${r.added} scenes${r.skipped ? `; skipped ${r.skipped} duplicates` : ''}.`)
  else if (r.skipped) toast(`${r.skipped} scenes are already in the queue.`)
  else if (empty) toast('No scene files found (.ma, .mb, .blend).', 'error')
}

export function openSettingsGuarded(): void {
  const { snap, openSettings, openPin } = useUi.getState()
  if (snap?.lock.locked) openPin(true)
  else openSettings(true)
}

export function applyFix(job: Job, issue: Issue): void {
  if (!issue.fix) return
  if (issue.fix.patch) void window.rd.updateJobs([job.id], { overrides: issue.fix.patch })
  else if (issue.fix.action === 'details') useUi.getState().openDetails([job.id])
}

export function dismissIssue(job: Job, issue: Issue): void {
  void window.rd.updateJobs([job.id], { dismiss: [issue.code] })
}
