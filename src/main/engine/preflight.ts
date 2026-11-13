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
  if (!fs.existsSync(j.scenePath)) out.push({ level: 'error', code: 'scene-missing', message: '씬 파일을 찾을 수 없습니다.' })
  if (!s.outputRoot) out.push({ level: 'error', code: 'no-output', message: '저장 폴더가 지정되지 않았습니다.' })
  if (!installs.some((i) => i.app === j.app))
    out.push({ level: 'error', code: 'no-app', message: `설치된 ${appName}를 찾지 못했습니다. 환경 설정의 프로그램에서 등록하세요.` })
  if (s.outputRoot && j.enabled && collision)
    out.push({
      level: 'error',
      code: 'collision',
      message: '다른 씬과 저장 경로가 겹칩니다.',
      fix: { label: '씬 설정 열기', action: 'details' }
    })
  if (info.state === 'error')
    out.push({ level: 'error', code: 'probe', message: `씬 파일을 분석할 수 없습니다. ${info.error ?? ''}`.trim() })
  if (info.state === 'done' && !j.frames.length)
    out.push({
      level: 'error',
      code: 'no-frames',
      message: '렌더할 프레임이 없습니다.',
      fix: { label: '씬 설정 열기', action: 'details' }
    })
  const choice = chooseInstall(installs, j.app, blender ? s.blenderVersion : s.mayaVersion, j.info.version)
  if (choice.install && choice.mismatch) {
    out.push(
      blender
        ? {
            level: 'warn',
            code: 'version-mismatch',
            message: `씬이 Blender ${info.version}에서 저장되었는데 이보다 낮은 Blender ${choice.install.version}로 렌더합니다. 일부 설정이 빠질 수 있습니다.`
          }
        : {
            level: 'warn',
            code: 'maya-mismatch',
            message: `씬 저장 버전(Maya ${info.version})과 렌더 버전(Maya ${choice.install.version})이 다릅니다.`
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
        message: `${naScene ? '씬 파일' : '저장'} 경로에 영문 외 문자가 있습니다: ${naScene ?? naOut}. Maya 렌더가 실패할 수 있습니다.`
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
        message: `지정한 카메라(${s.camera})가 씬에 없습니다.`,
        fix: { label: '카메라 선택', action: 'details' }
      })
    else if (!s.camera && !info.cameras.some((c) => c.renderable))
      out.push({
        level: 'error',
        code: 'no-camera',
        message: info.cameras.length ? '씬에 렌더 카메라가 지정되지 않았습니다.' : '씬에 카메라가 없습니다.',
        fix:
          info.cameras.length === 1
            ? { label: `${info.cameras[0].name}로 렌더`, patch: { camera: info.cameras[0].name } }
            : info.cameras.length
              ? { label: '카메라 선택', action: 'details' }
              : undefined
      })
    if (s.format === 'scene' && info.imageFormat && MOVIE_FORMATS.has(info.imageFormat))
      out.push({
        level: 'warn',
        code: 'movie-format',
        message: '씬의 파일 형식이 동영상입니다. 중간에 멈추면 처음부터 다시 렌더해야 하고 빠진 프레임 검사도 할 수 없습니다.',
        fix: { label: 'PNG로 저장', patch: { format: 'png' } }
      })
  }
  if (info.state === 'done' && !blender && info.cameras.length) {
    if (s.camera && !info.cameras.some((c) => c.name === s.camera || c.name.endsWith(`|${s.camera}`)))
      out.push({
        level: 'warn',
        code: 'camera-missing',
        message: `지정한 카메라(${s.camera})가 씬에 없습니다.`,
        fix: { label: '카메라 선택', action: 'details' }
      })
    if (!s.camera && !info.cameras.some((c) => c.renderable))
      out.push({
        level: 'warn',
        code: 'no-camera',
        message: '렌더 카메라가 지정되지 않았습니다.',
        fix: { label: '카메라 선택', action: 'details' }
      })
    const renderable = info.cameras.filter((c) => c.renderable)
    const shortName = (n: string) => n.split('|').pop() ?? n
    const builtIn = renderable.filter((c) => DEFAULT_CAMERAS.has(shortName(c.name)))
    const custom = renderable.filter((c) => !DEFAULT_CAMERAS.has(shortName(c.name)))
    if (!s.camera && builtIn.length && custom.length === 1)
      out.push({
        level: 'warn',
        code: 'default-camera',
        message: `기본 카메라(${builtIn.map((c) => shortName(c.name)).join(', ')})도 렌더 카메라로 켜져 있어 함께 렌더됩니다.`,
        fix: { label: `${shortName(custom[0].name)}만 렌더`, patch: { camera: shortName(custom[0].name) } }
      })
    else if (!s.camera && renderable.length > 1)
      out.push({
        level: 'info',
        code: 'multi-camera',
        message: `렌더 카메라 ${renderable.length}대(${renderable.map((c) => c.name).join(', ')})가 각각 렌더됩니다.`,
        fix: { label: '카메라 선택', action: 'details' }
      })
  }
  if (info.state === 'done' && !blender && s.frameMode === 'scene') {
    if (info.animation === false && timeline)
      out.push({
        level: 'warn',
        code: 'anim-off',
        message: `렌더 설정의 애니메이션이 꺼져 있습니다. 렌더 설정 범위 ${info.start}-${info.end}, 타임라인 ${info.timelineStart}-${info.timelineEnd}.`,
        fix: { label: '타임라인 범위 사용', patch: { frameMode: 'timeline' } }
      })
    else if (timeline && (info.start !== info.timelineStart || info.end !== info.timelineEnd))
      out.push({
        level: 'warn',
        code: 'range-diff',
        message: `렌더 설정 범위(${info.start}-${info.end})와 타임라인(${info.timelineStart}-${info.timelineEnd})이 다릅니다.`,
        fix: { label: '타임라인 범위 사용', patch: { frameMode: 'timeline' } }
      })
  }
  if (info.state === 'done' && !blender && s.format !== 'scene') {
    const r = rendererFlag(s, j)
    if (r !== 'file' && !formatSupported(r))
      out.push({
        level: 'warn',
        code: 'format',
        message: `${r} 렌더러는 파일 형식 지정을 지원하지 않습니다. 씬에 설정된 형식으로 저장됩니다.`
      })
  }
  const dismissed = new Set(j.dismissed ?? [])
  return out.filter((i) => i.level === 'error' || !dismissed.has(i.code))
}
