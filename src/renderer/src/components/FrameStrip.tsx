import { useEffect, useRef } from 'react'
import type { Job } from '@shared/types'

interface Palette {
  cell: string
  done: string
  live: string
  miss: string
  complete: string
}

let palette: Palette | null = null

function colors(): Palette {
  if (palette) return palette
  const cs = getComputedStyle(document.documentElement)
  const v = (n: string) => cs.getPropertyValue(n).trim()
  palette = { cell: v('--cell'), done: v('--accent'), live: v('--accent-live'), miss: v('--red'), complete: v('--green-bar') }
  return palette
}

export function FrameStrip({ job }: { job: Job }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const sizeRef = useRef({ w: 0 })

  const draw = () => {
    const c = ref.current
    if (!c) return
    const w = c.clientWidth
    const h = c.clientHeight
    if (!w || !h) return
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const p = colors()
    const frames = job.frames
    const n = frames.length
    const idle = !job.enabled || job.status === 'skipped'
    ctx.globalAlpha = idle ? 0.5 : 1
    ctx.fillStyle = p.cell
    track(ctx, w, h)
    ctx.fill()
    if (!n) return
    const done = new Set(job.doneFrames)
    const missing = new Set(job.missingFrames)
    const finished = job.status === 'partial' || job.status === 'failed'
    const current = new Set<number>()
    for (const t of job.tasks) if (t.status === 'running' && t.currentFrame !== null) current.add(t.currentFrame)
    if (frames.every((f) => done.has(f))) {
      ctx.fillStyle = p.complete
      track(ctx, w, h)
      ctx.fill()
      return
    }
    if (!done.size && !current.size && !(finished && missing.size)) return
    ctx.save()
    track(ctx, w, h)
    ctx.clip()
    const bins = Math.max(1, Math.min(n, Math.floor(w)))
    const per = n / bins
    const binW = w / bins
    let runColor: string | null = null
    let runStart = 0
    const flush = (end: number) => {
      if (runColor) {
        ctx.fillStyle = runColor
        const x0 = Math.floor(runStart * binW)
        ctx.fillRect(x0, 0, Math.ceil(end * binW) - x0, h)
      }
    }
    for (let b = 0; b < bins; b++) {
      const from = Math.floor(b * per)
      const to = Math.max(from + 1, Math.floor((b + 1) * per))
      let d = 0
      let cur = false
      let miss = false
      for (let i = from; i < to && i < n; i++) {
        const f = frames[i]
        if (done.has(f)) d++
        if (current.has(f)) cur = true
        if (finished && missing.has(f)) miss = true
      }
      const color = cur ? p.live : miss ? p.miss : d > 0 ? p.done : null
      if (color !== runColor) {
        flush(b)
        runColor = color
        runStart = b
      }
    }
    flush(bins)
    ctx.restore()
  }

  useEffect(() => {
    draw()
  })

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ro = new ResizeObserver(() => {
      if (c.clientWidth !== sizeRef.current.w) {
        sizeRef.current.w = c.clientWidth
        draw()
      }
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  const label = job.frames.length ? `프레임 ${job.frames.length}개 중 ${job.doneFrames.length}개 완료` : '프레임 범위 확인 전'
  return <canvas ref={ref} className="strip" role="img" aria-label={label} />
}

function track(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const r = Math.min(h / 2, w / 2)
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.arcTo(w, 0, w, h, r)
  ctx.arcTo(w, h, 0, h, r)
  ctx.arcTo(0, h, 0, 0, r)
  ctx.arcTo(0, 0, w, 0, r)
  ctx.closePath()
}
