import fs from 'node:fs'
import type { Install, Issue, Job, RenderSettings } from '../../shared/types'
import { chooseInstall } from './installs'
import { MOVIE_FORMATS } from './blend'
import { formatSupported, rendererFlag } from './command'
import { APP_LABEL, nonAsciiPart } from './util'

const DEFAULT_CAMERAS = new Set(['persp', 'top', 'front', 'side'])

export function computeIssues(j: Job, s: RenderSettings, installs: Install[], collision: boolean): Issue[] {
  const out: Issue[] = []
  const info = j.info
  const blender = j.app === 'blender'
  const appName = APP_LABEL[j.app]
  const timeline = info.timelineStart !== null && info.timelineEnd !== null
  if (!fs.existsSync(j.scenePath)) out.push({ level: 'error', code: 'scene-missing', message: 'Scene file not found.' })
  if (!s.outputRoot) out.push({ level: 'error', code: 'no-output', message: 'Choose an output folder.' })
  if (!installs.some((i) => i.app === j.app))
    out.push({ level: 'error', code: 'no-app', message: `${appName} was not found. Add an installation in Preferences > Applications.` })
  if (s.outputRoot && j.enabled && collision)
    out.push({
      level: 'error',
      code: 'collision',
      message: 'Another scene uses the same output path.',
      fix: { label: 'Open scene settings', action: 'details' }
    })
  if (info.state === 'error')
    out.push({ level: 'error', code: 'probe', message: `Could not inspect the scene. ${info.error ?? ''}`.trim() })
  if (info.state === 'done' && !j.frames.length)
    out.push({
      level: 'error',
      code: 'no-frames',
      message: 'No frames to render.',
      fix: { label: 'Open scene settings', action: 'details' }
    })
  const choice = chooseInstall(installs, j.app, blender ? s.blenderVersion : s.mayaVersion, j.info.version)
  if (choice.install && choice.mismatch) {
    out.push(
      blender
        ? {
            level: 'warn',
            code: 'version-mismatch',
            message: `This scene was saved with Blender ${info.version}. Rendering with the older Blender ${choice.install.version} may omit settings.`
          }
        : {
            level: 'warn',
            code: 'maya-mismatch',
            message: `The scene was saved with Maya ${info.version}; the selected renderer is Maya ${choice.install.version}.`
          }
    )
  }
  if (!blender) {
    const naScene = nonAsciiPart(j.scenePath)
    const naOut = j.outputDir ? nonAsciiPart(j.outputDir) : null
    if (naScene || naOut)
      out.push({
        level: 'warn',
        code: 'non-ascii',
        message: `The ${naScene ? 'scene' : 'output'} path contains non-ASCII characters: ${naScene ?? naOut}. Maya may not render this path correctly.`
      })
  }
  const missingRefs = info.references.filter((r) => !r.exists).length
  if (missingRefs)
    out.push({
      level: 'warn',
      code: 'missing-refs',
      message: blender
        ? `Missing linked .blend files: ${missingRefs}. Their objects will be absent from the render.`
        : `Missing reference files: ${missingRefs}. Their objects will be absent from the render.`
    })
  const missingFiles = info.missingFiles ?? []
  if (missingFiles.length) {
    const first = missingFiles[0].split(/[\\/]/).pop()
    out.push({
      level: 'warn',
      code: 'missing-textures',
      message: `Missing textures (${missingFiles.length}): ${first}${missingFiles.length > 1 ? ` and ${missingFiles.length - 1} more` : ''}. These textures will be absent from the render.`
    })
  }
  if (info.state === 'done' && blender) {
    if (s.camera && !info.cameras.some((c) => c.name === s.camera))
      out.push({
        level: 'error',
        code: 'camera-missing',
        message: `Camera "${s.camera}" is not in this scene.`,
        fix: { label: 'Choose camera', action: 'details' }
      })
    else if (!s.camera && !info.cameras.some((c) => c.renderable))
      out.push({
        level: 'error',
        code: 'no-camera',
        message: info.cameras.length ? 'No render camera is assigned.' : 'This scene has no cameras.',
        fix:
          info.cameras.length === 1
            ? { label: `Render with ${info.cameras[0].name}`, patch: { camera: info.cameras[0].name } }
            : info.cameras.length
              ? { label: 'Choose camera', action: 'details' }
              : undefined
      })
    if (s.format === 'scene' && info.imageFormat && MOVIE_FORMATS.has(info.imageFormat))
      out.push({
        level: 'warn',
        code: 'movie-format',
        message:
          'The scene uses a video output format. Interrupted renders must restart from the beginning, and missing frames cannot be checked individually.',
        fix: { label: 'Use PNG', patch: { format: 'png' } }
      })
  }
  if (info.state === 'done' && !blender && info.cameras.length) {
    if (s.camera && !info.cameras.some((c) => c.name === s.camera || c.name.endsWith(`|${s.camera}`)))
      out.push({
        level: 'warn',
        code: 'camera-missing',
        message: `Camera "${s.camera}" is not in this scene.`,
        fix: { label: 'Choose camera', action: 'details' }
      })
    if (!s.camera && !info.cameras.some((c) => c.renderable))
      out.push({
        level: 'warn',
        code: 'no-camera',
        message: 'No render camera is enabled.',
        fix: { label: 'Choose camera', action: 'details' }
      })
    const renderable = info.cameras.filter((c) => c.renderable)
    const shortName = (n: string) => n.split('|').pop() ?? n
    const builtIn = renderable.filter((c) => DEFAULT_CAMERAS.has(shortName(c.name)))
    const custom = renderable.filter((c) => !DEFAULT_CAMERAS.has(shortName(c.name)))
    if (!s.camera && builtIn.length && custom.length === 1)
      out.push({
        level: 'warn',
        code: 'default-camera',
        message: `Default cameras (${builtIn.map((c) => shortName(c.name)).join(', ')}) are also enabled and will be rendered.`,
        fix: { label: `Render ${shortName(custom[0].name)} only`, patch: { camera: shortName(custom[0].name) } }
      })
    else if (!s.camera && renderable.length > 1)
      out.push({
        level: 'info',
        code: 'multi-camera',
        message: `${renderable.length} cameras will render separately: ${renderable.map((c) => c.name).join(', ')}.`,
        fix: { label: 'Choose camera', action: 'details' }
      })
  }
  if (info.state === 'done' && !blender && s.frameMode === 'scene') {
    if (info.animation === false && timeline)
      out.push({
        level: 'warn',
        code: 'anim-off',
        message: `Animation is disabled in the render settings. Render range: ${info.start}-${info.end}; timeline: ${info.timelineStart}-${info.timelineEnd}.`,
        fix: { label: 'Use timeline range', patch: { frameMode: 'timeline' } }
      })
    else if (timeline && (info.start !== info.timelineStart || info.end !== info.timelineEnd))
      out.push({
        level: 'warn',
        code: 'range-diff',
        message: `The render range (${info.start}-${info.end}) differs from the timeline (${info.timelineStart}-${info.timelineEnd}).`,
        fix: { label: 'Use timeline range', patch: { frameMode: 'timeline' } }
      })
  }
  if (info.state === 'done' && !blender && s.format !== 'scene') {
    const r = rendererFlag(s, j)
    if (r !== 'file' && !formatSupported(r))
      out.push({
        level: 'warn',
        code: 'format',
        message: `${r} uses the scene's output format; format overrides are not available for this renderer.`
      })
  }
  const dismissed = new Set(j.dismissed ?? [])
  return out.filter((i) => i.level === 'error' || !dismissed.has(i.code))
}
