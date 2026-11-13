import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import iconv from 'iconv-lite'
import type { LogLevel } from '../../shared/types'

export type RunnerEvent =
  | { type: 'line'; text: string; level: LogLevel }
  | { type: 'frameStart'; frame: number }
  | { type: 'frameEnd'; frame: number }
  | { type: 'percent'; percent: number }
  | { type: 'boot'; version: string }
  | { type: 'device'; text: string }

const ERROR_RE = /(^|\s)(\/\/\s*)?(Error|ERROR|Fatal|FATAL)\b[:\s]|Traceback \(most recent call last\)/
const ERROR_RE_I = /failed to open|cannot open file|failed to load scene|license (check )?(failed|error|denied)/i
const WARN_RE = /(^|\s)(\/\/\s*)?(Warning|WARNING)\b[:\s]/
const PERCENT_RE = /\|\s+(\d{1,3})%\s+done\b/
const BLENDER_STATUS_RE = /\bFra:\d+\s+Mem:/
const BLENDER_SAMPLE_RE = /\bSample (\d+)\/(\d+)|\bRendering (\d+) \/ (\d+) samples/
const DEVICE_RE = /@@RQ:DEVICE\s+(.*)$/
const FRAME_START_RE = /@@RQ:FRAME_START\s+(-?\d+(?:\.\d+)?)/
const FRAME_END_RE = /@@RQ:FRAME_END\s+(-?\d+(?:\.\d+)?)/
const BOOT_RE = /@@RQ:BOOT\s+(.*)$/

export function classify(text: string): LogLevel {
  if (PERCENT_RE.test(text) || BLENDER_STATUS_RE.test(text)) return 'progress'
  if (ERROR_RE.test(text) || ERROR_RE_I.test(text)) return 'error'
  if (WARN_RE.test(text)) return 'warn'
  return 'info'
}

let cachedEncoding: string | null = null

export async function detectConsoleEncoding(pref: 'auto' | 'utf8' | 'cp949'): Promise<string> {
  if (pref !== 'auto') return pref
  if (process.platform !== 'win32') return 'utf8'
  if (cachedEncoding) return cachedEncoding
  cachedEncoding = await new Promise<string>((resolve) => {
    execFile('cmd.exe', ['/d', '/c', 'chcp'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve('cp949')
      const m = /(\d{3,5})/.exec(stdout)
      const cp = m ? Number(m[1]) : 949
      const map: Record<number, string> = { 65001: 'utf8', 949: 'cp949', 932: 'shift_jis', 936: 'gbk', 950: 'big5', 437: 'cp437', 1252: 'win1252' }
      resolve(map[cp] ?? `cp${cp}`)
    })
  })
  return cachedEncoding
}

export class RenderProcess extends EventEmitter {
  child: ChildProcess | null = null
  killed = false
  private buf = ''

  constructor(
    private exe: string,
    private args: string[],
    private env: NodeJS.ProcessEnv,
    private cwd: string,
    private encoding: string
  ) {
    super()
  }

  start(): number | null {
    const child = spawn(this.exe, this.args, {
      env: this.env,
      cwd: this.cwd,
      windowsHide: true,
      detached: process.platform !== 'win32'
    })
    this.child = child
    const enc = iconv.encodingExists(this.encoding) ? this.encoding : 'utf8'
    const outDec = iconv.getDecoder(enc)
    const errDec = iconv.getDecoder(enc)
    child.stdout?.on('data', (d: Buffer) => this.feed(outDec.write(d)))
    child.stderr?.on('data', (d: Buffer) => this.feed(errDec.write(d)))
    child.on('error', (e) => {
      this.emitEvent({ type: 'line', text: `프로세스 실행 실패: ${e.message}`, level: 'error' })
      this.emit('exit', -1, null)
    })
    child.on('close', (code, signal) => {
      const rest = (outDec.end() ?? '') + (errDec.end() ?? '')
      if (rest) this.feed(rest)
      if (this.buf) {
        this.handleLine(this.buf)
        this.buf = ''
      }
      this.emit('exit', code, signal)
    })
    return child.pid ?? null
  }

  private feed(chunk: string) {
    if (!chunk) return
    this.buf += chunk
    const parts = this.buf.split(/\r\n|\n|\r/)
    this.buf = parts.pop() ?? ''
    for (const p of parts) this.handleLine(p)
  }

  private handleLine(raw: string) {
    const text = raw.replace(/\s+$/, '')
    if (!text) return
    let m = FRAME_END_RE.exec(text)
    if (m) {
      this.emitEvent({ type: 'frameEnd', frame: Math.round(Number(m[1])) })
      return
    }
    m = FRAME_START_RE.exec(text)
    if (m) {
      this.emitEvent({ type: 'frameStart', frame: Math.round(Number(m[1])) })
      return
    }
    m = BOOT_RE.exec(text)
    if (m) {
      this.emitEvent({ type: 'boot', version: m[1] })
      return
    }
    m = DEVICE_RE.exec(text)
    if (m) {
      this.emitEvent({ type: 'device', text: m[1] })
      return
    }
    const level = classify(text)
    if (level === 'progress') {
      const pm = PERCENT_RE.exec(text)
      if (pm) this.emitEvent({ type: 'percent', percent: Number(pm[1]) })
      const bm = BLENDER_SAMPLE_RE.exec(text)
      if (bm) {
        const a = Number(bm[1] ?? bm[3])
        const b = Number(bm[2] ?? bm[4])
        if (b > 0) this.emitEvent({ type: 'percent', percent: Math.min(100, Math.floor((a / b) * 100)) })
      }
    }
    this.emitEvent({ type: 'line', text, level })
  }

  private emitEvent(e: RunnerEvent) {
    this.emit('event', e)
  }

  kill(): void {
    if (!this.child || this.child.exitCode !== null) return
    this.killed = true
    killTree(this.child)
  }
}

export function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined)
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      return
    }
  }
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        try {
          child.kill('SIGKILL')
        } catch {
          return
        }
      }
    }
  }, 4000)
}
