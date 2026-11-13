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
    toast('렌더 대상 씬이 없습니다.', 'error')
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
  const { toast } = useUi.getState()
  const r = kind === 'files' ? await window.rd.pickFiles() : await window.rd.pickFolder()
  reportAdd(r)
}

export function reportAdd(r: { added: number; skipped: number }, empty = false): void {
  const { toast } = useUi.getState()
  if (r.added) toast(`씬 ${r.added}개를 추가했습니다${r.skipped ? ` (중복 ${r.skipped}개 제외)` : ''}.`)
  else if (r.skipped) toast(`이미 렌더 목록에 있는 씬입니다 (${r.skipped}개).`)
  else if (empty) toast('추가할 씬 파일(.ma, .mb, .blend)이 없습니다.', 'error')
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
