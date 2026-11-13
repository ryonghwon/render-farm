import fs from 'node:fs'
import path from 'node:path'

export interface SceneOpts {
  start?: number
  end?: number
  timelineStart?: number
  timelineEnd?: number
  renderer?: string
  camera?: string
  mock?: string
  width?: number
  height?: number
  animation?: boolean
  refs?: string[]
  layers?: string[]
  version?: string
  perspRenderable?: boolean
}

export function maScene(name: string, o: SceneOpts = {}): string {
  const start = o.start ?? 1
  const end = o.end ?? 12
  const cam = o.camera ?? 'shotCam'
  const lines = [
    `//Maya ASCII ${o.version ?? '2025'} scene`,
    `//Name: ${name}.ma`,
    `//Last modified: Thu, Oct 15, 2026 10:12:44 AM`,
    `//Codeset: UTF-8`,
    ...(o.mock ? [`//MOCK ${o.mock}`] : []),
    ...(o.refs ?? []).map((r, i) => `file -rdi 1 -ns "asset${i}" -rfn "asset${i}RN" -op "v=0;" -typ "mayaBinary" "${r}";`),
    `requires maya "${o.version ?? '2025'}";`,
    `requires -nodeType "aiOptions" -nodeType "aiAOVDriver" -nodeType "aiAOVFilter" "mtoa" "5.4.5";`,
    `currentUnit -l centimeter -a degree -t film;`,
    `fileInfo "application" "maya";`,
    `createNode transform -s -n "persp";`,
    `\tsetAttr ".v" no;`,
    `createNode camera -s -n "perspShape" -p "persp";`,
    `\tsetAttr -k off ".v" no;`,
    `\tsetAttr ".fl" 34.999999999999993;`,
    ...(o.perspRenderable ? [] : [`\tsetAttr ".rnd" no;`]),
    `createNode transform -s -n "top";`,
    `createNode camera -s -n "topShape" -p "top";`,
    `\tsetAttr ".rnd" no;`,
    `\tsetAttr ".o" yes;`,
    `createNode transform -n "${cam}";`,
    `\tsetAttr ".t" -type "double3" 12.5 6.1 22.4 ;`,
    `createNode camera -n "${cam}Shape" -p "${cam}";`,
    `\tsetAttr -k off ".v";`,
    `\tsetAttr ".fl" 50;`,
    `createNode renderLayerManager -n "renderLayerManager";`,
    `createNode renderLayer -n "defaultRenderLayer";`,
    `\tsetAttr ".g" yes;`,
    ...(o.layers ?? []).flatMap((l) => [`createNode renderLayer -n "${l}";`, `\tsetAttr ".do" 1;`]),
    `createNode aiOptions -s -n "defaultArnoldRenderOptions";`,
    `createNode aiAOVDriver -s -n "defaultArnoldDriver";`,
    `\tsetAttr ".ai_translator" -type "string" "exr";`,
    `createNode script -n "sceneConfigurationScriptNode";`,
    `\tsetAttr ".b" -type "string" "playbackOptions -min ${o.timelineStart ?? start} -max ${o.timelineEnd ?? end} -ast 1 -aet 200 ";`,
    `\tsetAttr ".st" 6;`,
    `select -ne :time1;`,
    `\tsetAttr ".o" 1;`,
    `select -ne :defaultRenderGlobals;`,
    `\taddAttr -ci true -h true -sn "dss" -ln "defaultSurfaceShader" -dt "string";`,
    `\tsetAttr ".ren" -type "string" "${o.renderer ?? 'arnold'}";`,
    `\tsetAttr ".outf" 51;`,
    `\tsetAttr ".imfkey" -type "string" "exr";`,
    `\tsetAttr ".an" ${o.animation === false ? 'no' : 'yes'};`,
    `\tsetAttr ".fs" ${start};`,
    `\tsetAttr ".ef" ${end};`,
    `\tsetAttr ".pff" yes;`,
    `\tsetAttr ".ifp" -type "string" "<Scene>";`,
    `select -ne :defaultResolution;`,
    `\tsetAttr ".w" ${o.width ?? 1920};`,
    `\tsetAttr ".h" ${o.height ?? 1080};`,
    `\tsetAttr ".pa" 1;`,
    `\tsetAttr ".dar" 1.7777777910232544;`,
    `connectAttr "${cam}Shape.msg" ":defaultRenderGlobals.cameras" -na;`,
    `// End of ${name}.ma`
  ].flatMap((l, i) => (l.startsWith('createNode ') ? [l, `\trename -uid "${name}-${i}";`] : [l]))
  return lines.join('\n') + '\n'
}

export function makeProject(root: string): { project: string; scenes: string; out: string } {
  const project = path.join(root, 'project')
  const scenes = path.join(project, 'scenes')
  const out = path.join(root, 'renders')
  fs.mkdirSync(scenes, { recursive: true })
  fs.mkdirSync(path.join(project, 'assets'), { recursive: true })
  fs.writeFileSync(
    path.join(project, 'workspace.mel'),
    '//Maya 2025 Project Definition\nworkspace -fr "scene" "scenes";\nworkspace -fr "images" "images";\n'
  )
  fs.writeFileSync(path.join(project, 'assets', 'char_rig.mb'), 'FOR4')
  return { project, scenes, out }
}

export function writeScene(dir: string, name: string, o: SceneOpts = {}): string {
  const p = path.join(dir, `${name}.ma`)
  fs.writeFileSync(p, maScene(name, o))
  return p
}
