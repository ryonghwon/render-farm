import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawn } from 'node:child_process'
import type { CameraInfo, LayerInfo, SceneInfo } from '../../shared/types'
import { emptySceneInfo } from './settings'

interface ByteSource {
  read(n: number): Promise<Buffer | null>
  skip(n: number): Promise<boolean>
  close(): Promise<void>
}

class FileSource implements ByteSource {
  private pos = 0
  constructor(private fd: fs.promises.FileHandle) {}
  async read(n: number): Promise<Buffer | null> {
    const buf = Buffer.alloc(n)
    let got = 0
    while (got < n) {
      const { bytesRead } = await this.fd.read(buf, got, n - got, this.pos + got)
      if (!bytesRead) return null
      got += bytesRead
    }
    this.pos += n
    return buf
  }
  async skip(n: number): Promise<boolean> {
    this.pos += n
    return true
  }
  async close(): Promise<void> {
    await this.fd.close()
  }
}

class StreamSource implements ByteSource {
  private chunks: Buffer[] = []
  private len = 0
  private done = false
  private it: AsyncIterator<Buffer>
  constructor(
    source: AsyncIterable<Buffer>,
    private onClose: () => Promise<void> | void
  ) {
    this.it = source[Symbol.asyncIterator]()
  }
  private async fill(n: number): Promise<void> {
    while (this.len < n && !this.done) {
      const r = await this.it.next()
      if (r.done) {
        this.done = true
        break
      }
      this.chunks.push(r.value)
      this.len += r.value.length
    }
  }
  async read(n: number): Promise<Buffer | null> {
    await this.fill(n)
    if (this.len < n) return null
    let out: Buffer
    if (this.chunks[0].length >= n) {
      out = this.chunks[0].subarray(0, n)
      this.chunks[0] = this.chunks[0].subarray(n)
      if (!this.chunks[0].length) this.chunks.shift()
    } else {
      out = Buffer.allocUnsafe(n)
      let o = 0
      while (o < n) {
        const c = this.chunks[0]
        const take = Math.min(c.length, n - o)
        c.copy(out, o, 0, take)
        o += take
        if (take === c.length) this.chunks.shift()
        else this.chunks[0] = c.subarray(take)
      }
    }
    this.len -= n
    return out
  }
  async skip(n: number): Promise<boolean> {
    while (n > 0) {
      if (!this.len) {
        await this.fill(1)
        if (!this.len) return false
      }
      const c = this.chunks[0]
      if (c.length <= n) {
        this.chunks.shift()
        this.len -= c.length
        n -= c.length
      } else {
        this.chunks[0] = c.subarray(n)
        this.len -= n
        n = 0
      }
    }
    return true
  }
  async close(): Promise<void> {
    await this.onClose()
  }
}

type ZstdZlib = { zstdDecompressSync?: (b: Buffer) => Buffer }

async function zstdFrames(fd: fs.promises.FileHandle, size: number): Promise<number[] | null> {
  if (size < 9) return null
  const foot = Buffer.alloc(9)
  await fd.read(foot, 0, 9, size - 9)
  if (foot.readUInt32LE(5) !== 0x8f92eab1) return null
  const count = foot.readUInt32LE(0)
  const entry = foot[4] & 0x80 ? 12 : 8
  const tableSize = count * entry + 9
  const table = Buffer.alloc(tableSize)
  await fd.read(table, 0, tableSize, size - tableSize)
  const sizes: number[] = []
  for (let i = 0; i < count; i++) sizes.push(table.readUInt32LE(i * entry))
  return sizes
}

async function* zstdChunks(fd: fs.promises.FileHandle, sizes: number[]): AsyncGenerator<Buffer> {
  const z = zlib as unknown as ZstdZlib
  let off = 0
  for (const n of sizes) {
    const comp = Buffer.alloc(n)
    await fd.read(comp, 0, n, off)
    off += n
    yield z.zstdDecompressSync!(comp)
  }
}

async function openSource(file: string): Promise<ByteSource> {
  const fd = await fs.promises.open(file, 'r')
  const magic = Buffer.alloc(4)
  await fd.read(magic, 0, 4, 0)
  if (magic.readUInt32BE(0) === 0x28b52ffd) {
    if (!(zlib as unknown as ZstdZlib).zstdDecompressSync) {
      await fd.close()
      throw new Error('압축된 .blend를 읽을 수 없는 실행 환경')
    }
    const size = (await fd.stat()).size
    const sizes = await zstdFrames(fd, size)
    if (!sizes) {
      await fd.close()
      throw new Error('압축 구조를 읽을 수 없음')
    }
    return new StreamSource(zstdChunks(fd, sizes), () => fd.close())
  }
  if (magic.readUInt16BE(0) === 0x1f8b) {
    await fd.close()
    const stream = fs.createReadStream(file, { highWaterMark: 1 << 20 }).pipe(zlib.createGunzip())
    return new StreamSource(stream as unknown as AsyncIterable<Buffer>, () => {
      stream.destroy()
    })
  }
  return new FileSource(fd)
}

interface Block {
  code: string
  sdna: number
  old: bigint
  nr: number
  data: Buffer
}

interface Field {
  type: string
  name: string
  offset: number
  size: number
  pointer: boolean
}

class Sdna {
  types: string[] = []
  lens: number[] = []
  structs = new Map<string, Field[]>()
  byIndex: string[] = []
  constructor(data: Buffer, ptr: number) {
    let o = 0
    const tag = () => {
      const t = data.toString('latin1', o, o + 4)
      o += 4
      return t
    }
    const align = () => {
      o = (o + 3) & ~3
    }
    if (tag() !== 'SDNA' || tag() !== 'NAME') throw new Error('SDNA 형식 오류')
    const nNames = data.readInt32LE(o)
    o += 4
    const names: string[] = []
    for (let i = 0; i < nNames; i++) {
      const e = data.indexOf(0, o)
      names.push(data.toString('latin1', o, e))
      o = e + 1
    }
    align()
    if (tag() !== 'TYPE') throw new Error('SDNA 형식 오류')
    const nTypes = data.readInt32LE(o)
    o += 4
    for (let i = 0; i < nTypes; i++) {
      const e = data.indexOf(0, o)
      this.types.push(data.toString('latin1', o, e))
      o = e + 1
    }
    align()
    if (tag() !== 'TLEN') throw new Error('SDNA 형식 오류')
    for (let i = 0; i < nTypes; i++) {
      this.lens.push(data.readUInt16LE(o))
      o += 2
    }
    align()
    if (tag() !== 'STRC') throw new Error('SDNA 형식 오류')
    const nStructs = data.readInt32LE(o)
    o += 4
    for (let i = 0; i < nStructs; i++) {
      const st = data.readUInt16LE(o)
      const nf = data.readUInt16LE(o + 2)
      o += 4
      const fields: Field[] = []
      let off = 0
      for (let f = 0; f < nf; f++) {
        const t = data.readUInt16LE(o)
        const n = names[data.readUInt16LE(o + 2)]
        o += 4
        const pointer = n.startsWith('*') || n.startsWith('(*')
        let count = 1
        for (const m of n.matchAll(/\[(\d+)\]/g)) count *= Number(m[1])
        const size = (pointer ? ptr : this.lens[t]) * count
        const clean = n
          .replace(/^[(*]+/, '')
          .replace(/\).*$/, '')
          .replace(/\[.*$/, '')
        fields.push({ type: this.types[t], name: clean, offset: off, size, pointer })
        off += size
      }
      this.structs.set(this.types[st], fields)
      this.byIndex[i] = this.types[st]
    }
  }
  field(struct: string, dotted: string): Field | null {
    let base = 0
    let cur = struct
    const parts = dotted.split('.')
    for (let i = 0; i < parts.length; i++) {
      const f = this.structs.get(cur)?.find((x) => x.name === parts[i])
      if (!f) return null
      if (i === parts.length - 1) return { ...f, offset: base + f.offset }
      base += f.offset
      cur = f.type
    }
    return null
  }
}

class View {
  constructor(
    private sdna: Sdna,
    private struct: string,
    private buf: Buffer,
    private ptr: number
  ) {}
  private f(name: string | string[]): Field | null {
    for (const n of Array.isArray(name) ? name : [name]) {
      const f = this.sdna.field(this.struct, n)
      if (f && f.offset + Math.min(f.size, 8) <= this.buf.length) return f
    }
    return null
  }
  int(name: string | string[]): number | null {
    const f = this.f(name)
    if (!f) return null
    if (f.type === 'char' || f.type === 'uchar' || f.type === 'int8_t' || f.type === 'uint8_t') return this.buf.readUInt8(f.offset)
    if (f.type === 'short' || f.type === 'int16_t') return this.buf.readInt16LE(f.offset)
    if (f.type === 'ushort' || f.type === 'uint16_t') return this.buf.readUInt16LE(f.offset)
    if (f.type === 'float') return this.buf.readFloatLE(f.offset)
    if (f.type === 'double') return this.buf.readDoubleLE(f.offset)
    if (f.type === 'int64_t' || f.type === 'uint64_t') return Number(this.buf.readBigInt64LE(f.offset))
    return this.buf.readInt32LE(f.offset)
  }
  str(name: string | string[]): string | null {
    const f = this.f(name)
    if (!f) return null
    const end = Math.min(f.offset + f.size, this.buf.length)
    const z = this.buf.indexOf(0, f.offset)
    return this.buf.toString('utf8', f.offset, z >= 0 && z < end ? z : end)
  }
  ptrAt(name: string | string[]): bigint {
    const f = this.f(name)
    if (!f) return 0n
    return this.ptr === 8 ? this.buf.readBigUInt64LE(f.offset) : BigInt(this.buf.readUInt32LE(f.offset))
  }
}

const IMTYPE: Record<number, string> = {
  0: 'targa',
  1: 'iris',
  4: 'jpeg',
  7: 'iris',
  14: 'targa',
  15: 'avi',
  16: 'avi',
  17: 'png',
  20: 'bmp',
  21: 'hdr',
  22: 'tiff',
  23: 'exr',
  24: 'ffmpeg',
  26: 'cineon',
  27: 'dpx',
  28: 'exr_multilayer',
  30: 'jp2',
  35: 'webp'
}

export const MOVIE_FORMATS = new Set(['ffmpeg', 'avi'])

export function engineKey(engine: string | null): string | null {
  if (!engine) return null
  if (engine === 'CYCLES') return 'cycles'
  if (engine.startsWith('BLENDER_EEVEE')) return 'eevee'
  if (engine === 'BLENDER_WORKBENCH') return 'workbench'
  return engine.toLowerCase()
}

function blenderVersion(code: string): string {
  if (code.length === 3) return `${Number(code[0])}.${Number(code.slice(1))}`
  return `${Number(code.slice(0, 2))}.${Number(code.slice(2))}`
}

export function resolveBlendPath(p: string, blendFile: string): string {
  let s = p
  if (s.startsWith('//')) s = path.join(path.dirname(blendFile), s.slice(2))
  if (process.platform !== 'win32') s = s.replace(/\\/g, '/')
  return path.normalize(s)
}

function exists(p: string): boolean {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function imageExists(p: string, source: number): boolean {
  if (source === 6) {
    const probe = p.replace(/<UDIM>/gi, '1001').replace(/<UVTILE>/gi, 'u1_v1')
    if (exists(probe)) return true
    const dir = path.dirname(p)
    const stem = path.basename(p).split(/<UDIM>|<UVTILE>/i)[0]
    try {
      return fs.readdirSync(dir).some((f) => f.startsWith(stem))
    } catch {
      return false
    }
  }
  if (source === 2) return exists(p) || exists(path.dirname(p))
  return exists(p)
}

export const BLEND_PARSER_VERSION = 1

export async function probeBlend(file: string): Promise<SceneInfo> {
  const info = emptySceneInfo()
  info.method = 'blend'
  info.parserVersion = BLEND_PARSER_VERSION
  const src = await openSource(file)
  try {
    const head = await src.read(12)
    if (!head || head.toString('latin1', 0, 7) !== 'BLENDER') throw new Error('Blender 파일이 아닙니다')
    let ptr: number
    let large = false
    let verCode: string
    if (/\d/.test(String.fromCharCode(head[7]))) {
      const size = Number(head.toString('latin1', 7, 9))
      const rest = await src.read(size - 12)
      if (!rest) throw new Error('파일 헤더 손상')
      const h = Buffer.concat([head, rest]).toString('latin1')
      ptr = h[9] === '_' ? 4 : 8
      if (h[12] !== 'v') throw new Error('지원하지 않는 바이트 순서')
      verCode = h.slice(13, size)
      large = true
    } else {
      ptr = head[7] === 0x5f ? 4 : 8
      if (head[8] !== 0x76) throw new Error('지원하지 않는 바이트 순서')
      verCode = head.toString('latin1', 9, 12)
    }
    info.version = blenderVersion(verCode)
    const headSize = large ? 32 : ptr === 8 ? 24 : 20
    const keep = new Set(['GLOB', 'SC\0\0', 'OB\0\0', 'IM\0\0', 'LI\0\0', 'DNA1'])
    const blocks: Block[] = []
    let owner = ''
    for (;;) {
      const bh = await src.read(headSize)
      if (!bh) break
      const code = bh.toString('latin1', 0, 4)
      let len: number
      let old: bigint
      let sdna: number
      let nr: number
      if (large) {
        sdna = bh.readInt32LE(4)
        old = bh.readBigUInt64LE(8)
        len = Number(bh.readBigInt64LE(16))
        nr = Number(bh.readBigInt64LE(24))
      } else {
        len = bh.readInt32LE(4)
        old = ptr === 8 ? bh.readBigUInt64LE(8) : BigInt(bh.readUInt32LE(8))
        sdna = bh.readInt32LE(ptr === 8 ? 16 : 12)
        nr = bh.readInt32LE(ptr === 8 ? 20 : 16)
      }
      if (code === 'ENDB') break
      if (code !== 'DATA') owner = code
      const want = keep.has(code) || (code === 'DATA' && owner === 'SC\0\0' && len <= 1 << 22)
      if (want) {
        const data = await src.read(len)
        if (!data) break
        blocks.push({ code, sdna, old, nr, data })
      } else if (!(await src.skip(len))) break
    }
    const dnaBlock = blocks.find((b) => b.code === 'DNA1')
    if (!dnaBlock) throw new Error('씬 정보 블록 없음')
    const dna = new Sdna(dnaBlock.data, ptr)
    const view = (b: Block, offset = 0) => new View(dna, dna.byIndex[b.sdna], offset ? b.data.subarray(offset) : b.data, ptr)
    const byOld = new Map<bigint, Block>()
    for (const b of blocks) if (b.code !== 'DNA1') byOld.set(b.old, b)
    const scenes = blocks.filter((b) => b.code === 'SC\0\0')
    const glob = blocks.find((b) => b.code === 'GLOB')
    const cur = glob ? view(glob).ptrAt('curscene') : 0n
    const sceneBlock = scenes.find((b) => b.old === cur) ?? scenes.find((b) => !view(b).ptrAt('id.lib')) ?? scenes[0]
    if (!sceneBlock) throw new Error('씬이 없습니다')
    const sc = view(sceneBlock)
    const pct = sc.int('r.size') || 100
    const xsch = sc.int('r.xsch')
    const ysch = sc.int('r.ysch')
    info.start = sc.int('r.sfra')
    info.end = sc.int('r.efra')
    info.step = Math.max(1, sc.int('r.frame_step') ?? 1)
    info.timelineStart = info.start
    info.timelineEnd = info.end
    info.animation = true
    info.width = xsch ? Math.round((xsch * pct) / 100) : null
    info.height = ysch ? Math.round((ysch * pct) / 100) : null
    const fps = sc.int('r.frs_sec')
    const base = sc.int('r.frs_sec_base') || 1
    info.fps = fps ? Math.round((fps / base) * 1000) / 1000 : null
    info.renderer = engineKey(sc.str('r.engine'))
    info.imagePrefix = sc.str('r.pic')
    const imtype = sc.int('r.im_format.imtype')
    info.imageFormat = imtype === null ? null : (IMTYPE[imtype] ?? `type${imtype}`)
    info.sceneName = (sc.str('id.name') ?? '').slice(2) || null
    const camPtr = sc.ptrAt('camera')
    const cameras: CameraInfo[] = []
    for (const b of blocks) {
      if (b.code !== 'OB\0\0') continue
      const ob = view(b)
      if (ob.int('type') !== 11) continue
      const name = (ob.str('id.name') ?? '').slice(2)
      if (name) cameras.push({ name, renderable: b.old === camPtr })
    }
    cameras.sort((a, b) => a.name.localeCompare(b.name))
    info.cameras = cameras
    const layers: LayerInfo[] = []
    let lp = sc.ptrAt('view_layers.first')
    for (let guard = 0; lp && guard < 256; guard++) {
      const b = byOld.get(lp)
      if (!b || b.code !== 'DATA') break
      const vl = new View(dna, 'ViewLayer', b.data, ptr)
      const name = vl.str('name')
      if (name) layers.push({ name, renderable: ((vl.int('flag') ?? 1) & 1) === 1 })
      lp = vl.ptrAt('next')
    }
    info.layers = layers
    const refs: SceneInfo['references'] = []
    for (const b of blocks) {
      if (b.code !== 'LI\0\0') continue
      const li = view(b)
      const p = li.str(['filepath', 'name'])
      if (!p) continue
      const resolved = resolveBlendPath(p, file)
      refs.push({ path: p, resolved, exists: exists(resolved) })
    }
    info.references = refs
    const missing: string[] = []
    for (const b of blocks) {
      if (b.code !== 'IM\0\0') continue
      const im = view(b)
      if (im.ptrAt('id.lib')) continue
      const source = im.int('source') ?? 0
      if (![1, 2, 3, 6].includes(source)) continue
      if (im.ptrAt('packedfile') || im.ptrAt('packedfiles.first')) continue
      const p = im.str(['filepath', 'name'])
      if (!p) continue
      if (!imageExists(resolveBlendPath(p, file), source)) missing.push(p)
    }
    info.missingFiles = missing
    info.plugins = []
    info.state = 'done'
    return info
  } finally {
    await src.close()
  }
}

export function blendHeaderVersion(file: string): string | null {
  try {
    const fd = fs.openSync(file, 'r')
    const b = Buffer.alloc(24)
    fs.readSync(fd, b, 0, 24, 0)
    fs.closeSync(fd)
    const s = b.toString('latin1')
    if (!s.startsWith('BLENDER')) return null
    if (/\d/.test(s[7])) return blenderVersion(s.slice(13, Number(s.slice(7, 9))))
    return blenderVersion(s.slice(9, 12))
  } catch {
    return null
  }
}

export function probeBlenderDeep(blender: string, scenePath: string, scriptPath: string, timeoutMs: number): Promise<SceneInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn(blender, ['--factory-startup', '-b', scenePath, '--python', scriptPath], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Blender 분석 시간 초과'))
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const m = /@@RQ:PROBE (\{.*\})/.exec(out)
      if (!m) return reject(new Error('Blender 분석 결과 없음'))
      try {
        const d = JSON.parse(m[1])
        const info = emptySceneInfo()
        info.method = 'blender'
        info.deep = true
        info.version = d.version ?? null
        info.sceneName = d.scene ?? null
        info.renderer = engineKey(d.engine ?? null)
        info.start = Number(d.start)
        info.end = Number(d.end)
        info.step = Math.max(1, Number(d.step) || 1)
        info.timelineStart = info.start
        info.timelineEnd = info.end
        info.animation = true
        info.width = Number(d.width) || null
        info.height = Number(d.height) || null
        info.fps = Number(d.fps) || null
        info.imagePrefix = d.prefix ?? null
        info.imageFormat =
          String(d.format ?? '')
            .toLowerCase()
            .replace('open_exr_multilayer', 'exr_multilayer')
            .replace('open_exr', 'exr') || null
        info.cameras = Array.isArray(d.cameras) ? d.cameras : []
        info.layers = Array.isArray(d.layers) ? d.layers : []
        info.references = (Array.isArray(d.libraries) ? d.libraries : []).map((p: string) => {
          const resolved = resolveBlendPath(p, scenePath)
          return { path: p, resolved, exists: exists(resolved) }
        })
        info.missingFiles = Array.isArray(d.missing) ? d.missing : []
        info.state = 'done'
        resolve(info)
      } catch (e) {
        reject(e as Error)
      }
    })
  })
}
