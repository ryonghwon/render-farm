import fs from 'node:fs'
import path from 'node:path'
import { makeProject, writeScene } from '../fixtures'

const root = process.argv[2]
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })
const p = makeProject(root)
writeScene(p.scenes, 'SQ01_SH010', { start: 1001, end: 1072, timelineStart: 1001, timelineEnd: 1072, mock: 'speed=240' })
writeScene(p.scenes, 'SQ01_SH020', { start: 1001, end: 1036, timelineStart: 1001, timelineEnd: 1036, mock: 'speed=200' })
writeScene(p.scenes, 'SQ01_SH030', { start: 1001, end: 1048, timelineStart: 1001, timelineEnd: 1048, mock: 'speed=200 fail=1012 once warn' })
writeScene(p.scenes, 'SQ02_SH010', { start: 1, end: 96, timelineStart: 1, timelineEnd: 120, camera: 'cam_SQ02', layers: ['rs_char', 'rs_bg'], mock: 'speed=160' })
writeScene(p.scenes, 'SQ02_SH020', { start: 1, end: 48, camera: 'cam_SQ02', refs: ['assets/char_rig.mb', 'assets/prop_umbrella.mb'], mock: 'speed=160' })
writeScene(p.scenes, 'SQ02_SH030', { start: 1, end: 24, camera: 'cam_SQ02', mock: 'speed=160' })
const blend = (name: string, fixture: string, mock: string) => {
  const dst = path.join(p.scenes, `${name}.blend`)
  fs.copyFileSync(path.resolve(__dirname, '../fixtures-blend', `${fixture}.blend`), dst)
  fs.writeFileSync(`${dst}.mock`, mock)
}
blend('BL_SH010', 'basic', 'speed=900 gpu')
blend('BL_SH020', 'basic45', 'speed=700 gpu')
const mock = path.resolve(__dirname, '../mock-maya/maya2025/bin/Render')
const mockBlender = path.resolve(__dirname, '../mock-blender/blender-5.2/blender')
fs.chmodSync(mock, 0o755)
fs.chmodSync(mockBlender, 0o755)
fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ ...p, root, mock, mockBlender, shots: path.join(root, 'shots'), data: path.join(root, 'data') }, null, 2))
console.log(path.join(root, 'manifest.json'))
