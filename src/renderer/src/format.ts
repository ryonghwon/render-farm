import type { AppKind, CompletionAction, Job, JobStatus } from '@shared/types'

export const APP_LABEL: Record<AppKind, string> = { maya: 'Maya', blender: 'Blender' }

export const STATUS_LABEL: Record<JobStatus, string> = {
  idle: '대기',
  rendering: '렌더 중',
  done: '완료',
  partial: '빠진 프레임',
  failed: '실패',
  stopped: '중지됨',
  skipped: '건너뜀'
}

export function waitLabel(j: Job): string | null {
  if (j.status !== 'rendering' || j.tasks.some((t) => t.status === 'running')) return null
  const pending = j.tasks.filter((t) => t.status === 'pending')
  if (!pending.length) return null
  return pending.some((t) => (t.licenseTries ?? 0) > 0) ? '라이선스 대기' : '다음 렌더 대기'
}

export function jobStatusLabel(j: Job): string {
  if (j.info.state === 'running' || j.info.state === 'pending') return '분석 중'
  if (!j.enabled && j.status === 'idle') return '제외'
  return STATUS_LABEL[j.status]
}

export function jobTone(j: Job): string {
  if (!j.enabled && j.status === 'idle') return 'muted'
  switch (j.status) {
    case 'rendering':
      return 'active'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    case 'partial':
    case 'stopped':
      return 'attention'
    case 'skipped':
      return 'muted'
    default:
      return 'idle'
  }
}

const RENDERER_LABEL: Record<string, string> = {
  arnold: 'Arnold',
  mayaSoftware: 'Maya Software',
  sw: 'Maya Software',
  mayaHardware2: 'Hardware 2.0',
  hw2: 'Hardware 2.0',
  redshift: 'Redshift',
  vray: 'V-Ray',
  renderman: 'RenderMan',
  cycles: 'Cycles',
  eevee: 'EEVEE',
  workbench: 'Workbench',
  file: '씬 그대로',
  scene: '씬 그대로'
}

export function rendererLabel(r: string | null | undefined): string {
  if (!r) return '알 수 없음'
  return RENDERER_LABEL[r] ?? r
}

export const ACTION_LABEL: Record<CompletionAction, string> = {
  none: '없음',
  sleep: '절전 모드',
  shutdown: 'PC 끄기',
  quit: '렌더팜 닫기'
}

export function duration(ms: number | null | undefined, approx = false): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-'
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const prefix = approx ? '약 ' : ''
  if (h) return `${prefix}${h}시간 ${m}분`
  if (m) return `${prefix}${m}분 ${approx ? '' : `${sec}초`}`.trim()
  return approx ? '1분 미만' : `${sec}초`
}

export function clock(t: number): string {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function num(n: number): string {
  return n.toLocaleString('ko-KR')
}

export function frameRange(frames: number[]): string {
  if (!frames.length) return '-'
  const a = frames[0]
  const b = frames[frames.length - 1]
  return a === b ? `${a}` : `${a}-${b}`
}

export const FORMAT_INFO: Record<string, { label: string; short: string; desc: string }> = {
  exr: { label: 'EXR', short: '합성용 고정밀 이미지', desc: '합성 작업용 형식입니다. 색 정보 손실이 가장 적으며 파일 크기가 큽니다.' },
  png: { label: 'PNG', short: '검토 및 편집용 무손실 이미지', desc: '검토 및 편집용 형식입니다. 무손실 압축과 알파 채널을 지원합니다.' },
  jpg: { label: 'JPEG', short: '미리보기용 손실 압축 이미지', desc: '미리보기용 형식입니다. 파일 크기가 작으며 손실 압축이 적용됩니다.' },
  tif: { label: 'TIFF', short: '보관용 무손실 이미지', desc: '보관용 형식입니다. 무손실이며 파일 크기가 큽니다.' },
  scene: { label: '씬 그대로', short: '씬 렌더 설정의 형식 사용', desc: 'Maya 렌더 설정에 지정된 형식을 그대로 사용합니다.' }
}

export function shortPath(p: string | null | undefined, keep = 3): string {
  if (!p) return ''
  const parts = p.split(/[\\/]/).filter(Boolean)
  if (parts.length <= keep + 1) return p
  return `…/${parts.slice(-keep).join('/')}`
}

export function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
