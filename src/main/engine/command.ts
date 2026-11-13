import fs from 'node:fs'
import path from 'node:path'
import type { Install, Job, RenderSettings, Task } from '../../shared/types'
import { resolveTokens, splitArgs, toSlash } from './util'

export const SCENE_RENDERER_MAP: Record<string, string> = {
  arnold: 'arnold',
  mayaSoftware: 'sw',
  mayaHardware2: 'hw2',
  mayaHardware: 'hw',
  mayaVector: 'vr',
  redshift: 'redshift',
  vray: 'vray',
  renderman: 'renderman'
}

export function rendererFlag(settings: RenderSettings, job: Job): string {
  if (settings.renderer !== 'scene') return settings.renderer
  const r = job.info.renderer
  if (r && SCENE_RENDERER_MAP[r]) return SCENE_RENDERER_MAP[r]
  return 'file'
}

export function formatSupported(renderer: string): boolean {
  return renderer === 'arnold' || renderer === 'sw' || renderer === 'hw2' || renderer === 'hw'
}

export function resolvedPrefix(settings: RenderSettings, job: Job): string {
  const camera = settings.camera || job.info.cameras.find((c) => c.renderable)?.name || 'camera'
  return resolveTokens(settings.filePrefix || '{scene}', {
    scene: job.sceneName,
    camera,
    project: job.project ? path.basename(job.project) : ''
  })
}

export function resolvedOutputDir(settings: RenderSettings, job: Job): string {
  const camera = settings.camera || job.info.cameras.find((c) => c.renderable)?.name || 'camera'
  const sub = resolveTokens(settings.folderPattern || '', {
    scene: job.sceneName,
    camera,
    project: job.project ? path.basename(job.project) : ''
  })
  return path.normalize(sub ? path.join(settings.outputRoot, sub) : settings.outputRoot)
}

const BLENDER_EXT: Record<string, string> = {
  targa: 'tga',
  iris: 'rgb',
  bmp: 'bmp',
  hdr: 'hdr',
  webp: 'webp',
  dpx: 'dpx',
  cineon: 'cin',
  jp2: 'jp2',
  avif: 'avif'
}

export function expectedExt(settings: RenderSettings, job: Job): string {
  if (settings.format !== 'scene') return settings.format
  const f = (job.info.imageFormat || '').toLowerCase()
  if (f.includes('exr')) return 'exr'
  if (f.includes('png')) return 'png'
  if (f.includes('tif')) return 'tif'
  if (f.includes('jp2')) return 'jp2'
  if (f.includes('jp')) return 'jpg'
  if (BLENDER_EXT[f]) return BLENDER_EXT[f]
  return f || 'exr'
}

const SW_FORMAT: Record<string, { code: number; key: string }> = {
  exr: { code: 51, key: 'exr' },
  png: { code: 32, key: 'png' },
  tif: { code: 3, key: 'tif' },
  jpg: { code: 8, key: 'jpg' }
}

const ARNOLD_FORMAT: Record<string, string> = {
  exr: 'exr',
  png: 'png',
  tif: 'tif',
  jpg: 'jpeg'
}

export function buildMel(settings: RenderSettings, renderer: string): Record<string, string> {
  const lines: string[] = []
  lines.push('global proc rqBoot()')
  lines.push('{')
  lines.push('    print ("@@RQ:BOOT " + `about -v` + "\\n");')
  lines.push('    catch(`setAttr "defaultRenderGlobals.animation" 1`);')
  lines.push('    catch(`setAttr "defaultRenderGlobals.outFormatControl" 0`);')
  lines.push('    catch(`setAttr "defaultRenderGlobals.putFrameBeforeExt" 1`);')
  lines.push('    catch(`setAttr "defaultRenderGlobals.periodInExt" 1`);')
  lines.push(`    catch(\`setAttr "defaultRenderGlobals.extensionPadding" ${settings.padding}\`);`)
  if (settings.format !== 'scene') {
    const sw = SW_FORMAT[settings.format]
    if (renderer === 'arnold') {
      lines.push('    if (`objExists defaultArnoldDriver`) {')
      lines.push(`        catch(\`setAttr -type "string" defaultArnoldDriver.ai_translator "${ARNOLD_FORMAT[settings.format]}"\`);`)
      lines.push('    }')
    }
    if (sw) {
      lines.push(`    catch(\`setAttr "defaultRenderGlobals.imageFormat" ${sw.code}\`);`)
      lines.push(`    catch(\`setAttr -type "string" "defaultRenderGlobals.imfPluginKey" "${sw.key}"\`);`)
    }
  }
  lines.push('}')
  const pre = ['global proc rqPreFrame()', '{', '    print ("@@RQ:FRAME_START " + `currentTime -q` + "\\n");', '}']
  const post = ['global proc rqPostFrame()', '{', '    print ("@@RQ:FRAME_END " + `currentTime -q` + "\\n");', '}']
  return {
    'rqBoot.mel': lines.join('\n') + '\n',
    'rqPreFrame.mel': pre.join('\n') + '\n',
    'rqPostFrame.mel': post.join('\n') + '\n'
  }
}

export interface BuiltCommand {
  exe: string
  args: string[]
  env: NodeJS.ProcessEnv
  scriptDir: string
  renderer: string
  outputDir: string
  prefix: string
}

export interface CommandOptions {
  job: Job
  task: Task
  settings: RenderSettings
  install: Install
  taskDir: string
  threads: number
  arnoldVerbosity: number
}

export function buildCommand(opts: CommandOptions): BuiltCommand {
  return opts.job.app === 'blender' ? buildBlenderCommand(opts) : buildMayaCommand(opts)
}

function buildMayaCommand(opts: CommandOptions): BuiltCommand {
  const { job, task, settings, install, taskDir, threads, arnoldVerbosity } = opts
  const renderer = rendererFlag(settings, job)
  const outputDir = resolvedOutputDir(settings, job)
  const prefix = resolvedPrefix(settings, job)
  fs.mkdirSync(taskDir, { recursive: true })
  for (const [name, body] of Object.entries(buildMel(settings, renderer))) fs.writeFileSync(path.join(taskDir, name), body, 'utf8')
  const args: string[] = ['-r', renderer]
  args.push('-s', String(task.start), '-e', String(task.end), '-b', String(task.step))
  args.push('-rd', toSlash(outputDir))
  args.push('-im', prefix)
  if (settings.camera) args.push('-cam', settings.camera)
  if (settings.resolutionMode === 'custom') args.push('-x', String(settings.width), '-y', String(settings.height))
  if (job.project) args.push('-proj', toSlash(job.project))
  if (settings.layers && settings.layers.length) args.push('-rl', settings.layers.join(','))
  args.push('-preRender', 'rqBoot', '-preFrame', 'rqPreFrame', '-postFrame', 'rqPostFrame')
  if (renderer === 'arnold') {
    args.push('-ai:lve', String(arnoldVerbosity))
    if (threads > 0) args.push('-ai:threads', String(threads))
  } else if (renderer === 'sw' && threads > 0) {
    args.push('-n', String(threads))
  }
  if (settings.extraArgs.trim()) args.push(...splitArgs(settings.extraArgs))
  args.push(toSlash(job.scenePath))
  const sep = process.platform === 'win32' ? ';' : ':'
  const scriptPath = process.env.MAYA_SCRIPT_PATH ? `${toSlash(taskDir)}${sep}${process.env.MAYA_SCRIPT_PATH}` : toSlash(taskDir)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MAYA_SCRIPT_PATH: scriptPath,
    MAYA_DISABLE_CIP: '1',
    MAYA_DISABLE_CER: '1',
    MAYA_DISABLE_CLIC_IPM: '1',
    PYTHONUNBUFFERED: '1'
  }
  return { exe: install.renderPath, args, env, scriptDir: taskDir, renderer, outputDir, prefix }
}

const BLENDER_FORMAT: Record<string, string> = {
  exr: 'OPEN_EXR_MULTILAYER',
  png: 'PNG',
  tif: 'TIFF',
  jpg: 'JPEG'
}

export function blenderBoot(config: Record<string, unknown>): string {
  return `import bpy, os, sys, json
S = json.loads(r'''${JSON.stringify(config)}''')
def say(m):
    sys.stdout.write('@@RQ:' + m + '\\n')
    sys.stdout.flush()
def warn(m):
    sys.stdout.write('Warning: ' + m + '\\n')
    sys.stdout.flush()
sc = bpy.context.scene
r = sc.render
say('BOOT ' + bpy.app.version_string)
try:
    im = r.image_settings
    fmt = S.get('format')
    if fmt:
        if hasattr(im, 'media_type'):
            im.media_type = 'MULTI_LAYER_IMAGE' if fmt == 'OPEN_EXR_MULTILAYER' else 'IMAGE'
        im.file_format = fmt
except Exception as e:
    warn('file format: %s' % e)
r.filepath = S['output']
r.use_file_extension = True
try:
    r.use_overwrite = True
    r.use_placeholder = False
except Exception:
    pass
cam = S.get('camera')
if cam:
    ob = bpy.data.objects.get(cam)
    if ob is not None and ob.type == 'CAMERA':
        sc.camera = ob
    else:
        warn('camera not found: ' + cam)
if S.get('width'):
    r.resolution_x = int(S['width'])
    r.resolution_y = int(S['height'])
    r.resolution_percentage = 100
layers = S.get('layers')
if layers is not None:
    for vl in sc.view_layers:
        vl.use = vl.name in layers
dev = S.get('device', 'scene')
if r.engine == 'CYCLES' and dev != 'scene':
    chosen = None
    if dev == 'auto':
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            for t in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
                try:
                    prefs.compute_device_type = t
                except Exception:
                    continue
                refresh = getattr(prefs, 'refresh_devices', None) or getattr(prefs, 'get_devices', None)
                if refresh:
                    refresh()
                gpus = [d for d in prefs.devices if d.type == t]
                if gpus:
                    for d in prefs.devices:
                        d.use = d.type == t
                    chosen = (t, gpus)
                    break
        except Exception as e:
            warn('GPU setup: %s' % e)
    if chosen:
        sc.cycles.device = 'GPU'
        say('DEVICE %s %s' % (chosen[0], ', '.join(d.name for d in chosen[1])))
    else:
        sc.cycles.device = 'CPU'
        say('DEVICE CPU')
for img in bpy.data.images:
    try:
        if img.library or img.packed_file or img.source not in ('FILE', 'SEQUENCE', 'MOVIE', 'TILED') or not img.filepath:
            continue
        p = bpy.path.abspath(img.filepath)
        if img.source == 'TILED':
            p = p.replace('<UDIM>', '1001').replace('<UVTILE>', 'u1_v1')
        if not os.path.exists(p):
            warn('missing image: ' + img.filepath)
    except Exception:
        pass
def _rf_pre(scene, *args):
    say('FRAME_START %d' % scene.frame_current)
def _rf_post(scene, *args):
    say('FRAME_END %d' % scene.frame_current)
bpy.app.handlers.render_pre.append(_rf_pre)
bpy.app.handlers.render_write.append(_rf_post)
`
}

function buildBlenderCommand(opts: CommandOptions): BuiltCommand {
  const { job, task, settings, install, taskDir, threads } = opts
  const outputDir = resolvedOutputDir(settings, job)
  const prefix = resolvedPrefix(settings, job)
  fs.mkdirSync(taskDir, { recursive: true })
  const config = {
    output: toSlash(path.join(outputDir, `${prefix}.${'#'.repeat(Math.max(1, settings.padding))}`)),
    format: settings.format === 'scene' ? null : BLENDER_FORMAT[settings.format],
    camera: settings.camera || null,
    width: settings.resolutionMode === 'custom' ? settings.width : null,
    height: settings.resolutionMode === 'custom' ? settings.height : null,
    layers: settings.layers && settings.layers.length ? settings.layers : null,
    device: settings.device
  }
  const boot = path.join(taskDir, 'rf_boot.py')
  fs.writeFileSync(boot, blenderBoot(config), 'utf8')
  const args: string[] = ['-b', job.scenePath, '--python', boot]
  if (threads > 0) args.push('-t', String(threads))
  args.push('-s', String(task.start), '-e', String(task.end), '-j', String(task.step))
  if (settings.extraArgs.trim()) args.push(...splitArgs(settings.extraArgs))
  args.push('-a')
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
  return { exe: install.renderPath, args, env, scriptDir: taskDir, renderer: job.info.renderer ?? 'blender', outputDir, prefix }
}

export const BLENDER_PROBE_PY = `import bpy, sys, os, json
sc = bpy.context.scene
r = sc.render
out = {
    'version': '%d.%d' % bpy.app.version[:2],
    'scene': sc.name,
    'engine': r.engine,
    'start': sc.frame_start,
    'end': sc.frame_end,
    'step': sc.frame_step,
    'width': round(r.resolution_x * r.resolution_percentage / 100),
    'height': round(r.resolution_y * r.resolution_percentage / 100),
    'fps': r.fps / (r.fps_base or 1),
    'prefix': r.filepath,
    'format': r.image_settings.file_format,
    'cameras': [{'name': o.name, 'renderable': o == sc.camera} for o in bpy.data.objects if o.type == 'CAMERA'],
    'layers': [{'name': v.name, 'renderable': bool(v.use)} for v in sc.view_layers],
    'libraries': [l.filepath for l in bpy.data.libraries],
    'missing': [],
}
for img in bpy.data.images:
    try:
        if img.library or img.packed_file or img.source not in ('FILE', 'SEQUENCE', 'MOVIE', 'TILED') or not img.filepath:
            continue
        p = bpy.path.abspath(img.filepath).replace('<UDIM>', '1001').replace('<UVTILE>', 'u1_v1')
        if not os.path.exists(p):
            out['missing'].append(img.filepath)
    except Exception:
        pass
sys.stdout.write('@@RQ:PROBE ' + json.dumps(out) + '\\n')
sys.stdout.flush()
`
