import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import type { CameraInfo, LayerInfo, SceneInfo } from '../../shared/types'
import { emptySceneInfo, fpsFromUnit } from './settings'

export const PARSER_VERSION = 2

type NodeCtx = { kind: 'camera'; cam: CameraInfo } | { kind: 'layer'; layer: LayerInfo } | { kind: 'globals' } | { kind: 'resolution' } | { kind: 'arnoldDriver' } | { kind: 'other' }

function lastQuoted(line: string): string | null {
  const all = [...line.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
  return all.length ? all[all.length - 1][1] : null
}

function flagValue(line: string, flag: string): string | null {
  const re = new RegExp(`${flag}\\s+"((?:[^"\\\\]|\\\\.)*)"`)
  const m = re.exec(line)
  return m ? m[1] : null
}

function setAttrValue(line: string): { attr: string; value: string } | null {
  const m = /^\s*setAttr\s+(?:-[a-zA-Z]+\s+(?:\S+\s+)?)*"\.([\w[\]]+)"\s+(.*?);?\s*$/.exec(line)
  if (!m) return null
  let value = m[2].trim()
  const typed = /-type\s+"[^"]+"\s+(.*)$/.exec(value)
  if (typed) value = typed[1].trim()
  value = value.replace(/;$/, '').trim()
  if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
  return { attr: m[1], value }
}

function bool(v: string): boolean {
  return v === 'yes' || v === 'true' || v === '1'
}

export async function probeAscii(scenePath: string): Promise<SceneInfo> {
  const info = emptySceneInfo()
  info.method = 'ascii'
  info.parserVersion = PARSER_VERSION
  const cameras: CameraInfo[] = []
  const layers: LayerInfo[] = []
  const refs: string[] = []
  const plugins = new Set<string>()
  let ctx: NodeCtx = { kind: 'other' }
  let first = true
  const stream = fs.createReadStream(scenePath, { encoding: 'utf8', highWaterMark: 1 << 20 })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const raw of rl) {
    const line = raw.length > 4000 ? raw.slice(0, 4000) : raw
    if (first) {
      first = false
      const m = /^\/\/Maya ASCII (\S+) scene/.exec(line)
      if (m) info.version = m[1]
      continue
    }
    const t = line.trimStart()
    if (!t) continue
    const c0 = t.charCodeAt(0)
    if (c0 === 47) continue
    if (t.startsWith('requires')) {
      const mv = /^requires\s+maya\s+"([^"]+)"/.exec(t)
      if (mv) {
        info.version = mv[1]
        continue
      }
      const all = [...t.matchAll(/"([^"]+)"/g)].map((x) => x[1])
      if (all.length >= 2) plugins.add(all[all.length - 2])
      continue
    }
    if (t.startsWith('currentUnit')) {
      const u = /-t\s+(\S+?);?\s*$/.exec(t) || /-t\s+(\S+)/.exec(t)
      if (u) info.fps = fpsFromUnit(u[1].replace(/;$/, ''))
      continue
    }
    if (t.startsWith('file ')) {
      if (/^file\s+(-rdi|-r)\b/.test(t)) {
        const q = lastQuoted(t)
        if (q && !refs.includes(q)) refs.push(q)
      }
      continue
    }
    if (t.startsWith('createNode ')) {
      const type = /^createNode\s+(\S+)/.exec(t)?.[1] ?? ''
      const name = flagValue(t, '-n') ?? ''
      const parent = flagValue(t, '-p')
      if (type === 'camera') {
        const cam: CameraInfo = { name: parent ?? name, renderable: true }
        cameras.push(cam)
        ctx = { kind: 'camera', cam }
      } else if (type === 'renderLayer') {
        if (name && !name.includes(':')) {
          const layer: LayerInfo = { name, renderable: true }
          layers.push(layer)
          ctx = { kind: 'layer', layer }
        } else ctx = { kind: 'other' }
      } else if (type === 'aiAOVDriver' && name === 'defaultArnoldDriver') {
        ctx = { kind: 'arnoldDriver' }
      } else if (type === 'script' && name === 'sceneConfigurationScriptNode') {
        ctx = { kind: 'other' }
      } else ctx = { kind: 'other' }
      continue
    }
    if (t.startsWith('select ')) {
      if (/:defaultRenderGlobals\b/.test(t)) ctx = { kind: 'globals' }
      else if (/:defaultResolution\b/.test(t)) ctx = { kind: 'resolution' }
      else if (/:defaultArnoldDriver\b/.test(t)) ctx = { kind: 'arnoldDriver' }
      else ctx = { kind: 'other' }
      continue
    }
    if (t.startsWith('setAttr')) {
      if (t.includes('playbackOptions')) {
        const mn = /-min\s+(-?[\d.]+)/.exec(t)
        const mx = /-max\s+(-?[\d.]+)/.exec(t)
        if (mn) info.timelineStart = Number(mn[1])
        if (mx) info.timelineEnd = Number(mx[1])
      }
      if (ctx.kind === 'other') continue
      const sv = setAttrValue(t)
      if (!sv) continue
      if (ctx.kind === 'camera') {
        if (sv.attr === 'rnd') ctx.cam.renderable = bool(sv.value)
      } else if (ctx.kind === 'layer') {
        if (sv.attr === 'rndr') ctx.layer.renderable = bool(sv.value)
      } else if (ctx.kind === 'globals') {
        switch (sv.attr) {
          case 'ren':
            info.renderer = sv.value
            break
          case 'an':
            info.animation = bool(sv.value)
            break
          case 'fs':
            info.start = Number(sv.value)
            break
          case 'ef':
            info.end = Number(sv.value)
            break
          case 'bfs':
            info.step = Number(sv.value)
            break
          case 'ifp':
            info.imagePrefix = sv.value
            break
          case 'imfkey':
            info.imageFormat = sv.value
            break
        }
      } else if (ctx.kind === 'resolution') {
        if (sv.attr === 'w') info.width = Number(sv.value)
        if (sv.attr === 'h') info.height = Number(sv.value)
      } else if (ctx.kind === 'arnoldDriver') {
        if (sv.attr === 'ai_translator') info.imageFormat = sv.value
      }
      continue
    }
    if (t.startsWith('connectAttr') || t.startsWith('relationship') || t.startsWith('lockNode') || (t.startsWith('rename ') && !/^rename\s+-uid\b/.test(t))) {
      ctx = { kind: 'other' }
    }
  }
  if (info.renderer === null && plugins.has('mtoa')) info.renderer = 'arnold'
  if (info.renderer === null) info.renderer = 'mayaSoftware'
  if (info.start === null) info.start = 1
  if (info.end === null) info.end = 10
  if (info.step === null) info.step = 1
  if (info.animation === null) info.animation = false
  if (info.width === null) info.width = 960
  if (info.height === null) info.height = 540
  if (info.fps === null) info.fps = 24
  info.cameras = cameras
  info.layers = layers
  info.plugins = [...plugins]
  info.references = resolveRefs(refs, scenePath)
  info.state = 'done'
  return info
}

export function resolveRefs(refs: string[], scenePath: string, project?: string | null): SceneInfo['references'] {
  const sceneDir = path.dirname(scenePath)
  return refs.map((r) => {
    const clean = r.replace(/\{\d+\}$/, '')
    const candidates = path.isAbsolute(clean) || /^[a-zA-Z]:[\\/]/.test(clean) ? [clean] : [path.join(project ?? sceneDir, clean), path.join(sceneDir, clean)]
    const hit = candidates.find((c) => {
      try {
        return fs.existsSync(c)
      } catch {
        return false
      }
    })
    return { path: clean, resolved: hit ?? candidates[0], exists: !!hit }
  })
}

export async function probeBinary(scenePath: string): Promise<SceneInfo> {
  const info = emptySceneInfo()
  info.method = 'binary'
  const fd = await fs.promises.open(scenePath, 'r')
  try {
    const size = (await fd.stat()).size
    const head = Buffer.alloc(Math.min(size, 1 << 20))
    await fd.read(head, 0, head.length, 0)
    const s = head.toString('latin1')
    const ver = /version\x00(\d{4}(?:\.\d+)*)/.exec(s) || /product\x00Maya (\d{4})/.exec(s)
    if (ver) info.version = ver[1]
    const unit = /-t\x00?(\w+)/.exec(s)
    if (unit) info.fps = fpsFromUnit(unit[1])
    const plugs = new Set<string>()
    for (const m of s.matchAll(/(mtoa|redshift4maya|vrayformaya|renderSetup|mayaHIK|AbcImport)\x00/g)) plugs.add(m[1])
    info.plugins = [...plugs]
    if (plugs.has('mtoa')) info.renderer = 'arnold'
    else if (plugs.has('redshift4maya')) info.renderer = 'redshift'
    else if (plugs.has('vrayformaya')) info.renderer = 'vray'
  } finally {
    await fd.close()
  }
  info.state = 'done'
  return info
}

export interface DeepProbeOptions {
  mayapy: string
  scriptPath: string
  timeoutMs: number
}

export function probeDeep(scenePath: string, opts: DeepProbeOptions): Promise<Partial<SceneInfo> & { refsRaw?: string[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.mayapy, [opts.scriptPath, scenePath], { windowsHide: true, env: { ...process.env, MAYA_DISABLE_CIP: '1', MAYA_DISABLE_CER: '1' } })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('mayapy 분석 시간 초과'))
    }, opts.timeoutMs)
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(timer)
      const m = /@@RQ:PROBE (\{.*\})/.exec(out)
      if (!m) return reject(new Error('mayapy 분석 결과 없음'))
      try {
        const d = JSON.parse(m[1])
        resolve({
          method: 'mayapy',
          deep: true,
          version: d.version ?? null,
          renderer: d.renderer ?? null,
          start: num(d.start),
          end: num(d.end),
          step: num(d.step),
          animation: d.animation === undefined ? null : !!d.animation,
          timelineStart: num(d.timelineStart),
          timelineEnd: num(d.timelineEnd),
          width: num(d.width),
          height: num(d.height),
          fps: fpsFromUnit(d.timeUnit),
          imagePrefix: d.prefix || null,
          imageFormat: d.arnoldFormat || d.imfkey || null,
          cameras: Array.isArray(d.cameras) ? d.cameras : [],
          layers: Array.isArray(d.layers) ? d.layers : [],
          refsRaw: Array.isArray(d.references) ? d.references : []
        })
      } catch (e) {
        reject(e as Error)
      }
    })
  })
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export const PROBE_PY = `import sys, json, os
import maya.standalone
maya.standalone.initialize(name='python')
import maya.cmds as cmds
path = sys.argv[1]
out = {}
try:
    cmds.file(path, open=True, force=True, prompt=False, ignoreVersion=True, loadReferenceDepth='none')
except Exception as e:
    out['warn'] = str(e)
def ga(a, d=None):
    try:
        return cmds.getAttr(a)
    except Exception:
        return d
g = 'defaultRenderGlobals'
out['renderer'] = ga(g + '.currentRenderer')
out['start'] = ga(g + '.startFrame')
out['end'] = ga(g + '.endFrame')
out['step'] = ga(g + '.byFrameStep')
out['animation'] = ga(g + '.animation')
out['prefix'] = ga(g + '.imageFilePrefix')
out['imfkey'] = ga(g + '.imfPluginKey')
out['width'] = ga('defaultResolution.width')
out['height'] = ga('defaultResolution.height')
try:
    out['timelineStart'] = cmds.playbackOptions(q=True, min=True)
    out['timelineEnd'] = cmds.playbackOptions(q=True, max=True)
except Exception:
    pass
out['timeUnit'] = cmds.currentUnit(q=True, time=True)
cams = []
for s in cmds.ls(type='camera') or []:
    p = cmds.listRelatives(s, parent=True) or [s]
    cams.append({'name': p[0], 'renderable': bool(ga(s + '.renderable', False))})
out['cameras'] = cams
layers = []
for l in cmds.ls(type='renderLayer') or []:
    if ':' in l:
        continue
    layers.append({'name': l, 'renderable': bool(ga(l + '.renderable', True))})
out['layers'] = layers
refs = []
for r in cmds.file(q=True, reference=True) or []:
    try:
        refs.append(cmds.referenceQuery(r, filename=True, withoutCopyNumber=True))
    except Exception:
        refs.append(r)
out['references'] = refs
try:
    out['version'] = cmds.fileInfo('version', q=True)[0]
except Exception:
    pass
if cmds.objExists('defaultArnoldDriver'):
    out['arnoldFormat'] = ga('defaultArnoldDriver.ai_translator')
sys.stdout.write('@@RQ:PROBE ' + json.dumps(out) + '\\n')
sys.stdout.flush()
os._exit(0)
`
