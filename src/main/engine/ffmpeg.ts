import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

let resolved: string | null | undefined

export function findFfmpeg(custom: string): string | null {
  if (custom && fs.existsSync(custom)) return custom
  if (resolved !== undefined) return resolved
  resolved = null
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates: string[] = []
  const resPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resPath) candidates.push(path.join(resPath, 'ffmpeg', exe))
  for (const dir of (process.env.PATH || '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, exe))
  if (process.platform === 'darwin') candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg')
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        resolved = c
        break
      }
    } catch {
      continue
    }
  }
  return resolved
}

export function encodePreview(opts: {
  ffmpeg: string
  dir: string
  stem: string
  sep: string
  ext: string
  digits: number
  startFrame: number
  fps: number
  out: string
}): Promise<void> {
  const pattern = path.join(opts.dir, `${opts.stem}${opts.sep}%0${opts.digits}d.${opts.ext}`)
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  if (opts.ext === 'exr') args.push('-apply_trc', 'iec61966_2_1')
  args.push('-framerate', String(opts.fps), '-start_number', String(opts.startFrame), '-i', pattern)
  args.push(
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-movflags',
    '+faststart',
    opts.out
  )
  return new Promise((resolve, reject) => {
    const child = spawn(opts.ffmpeg, args, { windowsHide: true })
    let err = ''
    child.stderr.on('data', (d: Buffer) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg 종료 코드 ${code}`))))
  })
}

export function thumbnail(ffmpeg: string, src: string, out: string, width = 640): Promise<void> {
  const args = ['-y', '-hide_banner', '-loglevel', 'error']
  if (/\.exr$/i.test(src)) args.push('-apply_trc', 'iec61966_2_1')
  args.push('-i', src, '-vf', `scale=${width}:-2`, '-frames:v', '1', out)
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, { windowsHide: true, timeout: 20000 }, (e) => (e ? reject(e) : resolve()))
  })
}
