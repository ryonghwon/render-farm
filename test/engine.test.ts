import { manualInstall } from '../src/main/engine/installs'
import type { Install } from '../src/shared/types'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Engine } from '../src/main/engine/engine'
import { probeAscii } from '../src/main/engine/probe'
import { toRanges, compactFrames, describeExit } from '../src/main/engine/util'
import { parseFrameName } from '../src/main/engine/frames'
import { makeProject, writeScene } from './fixtures'

const MOCK = path.resolve(__dirname, 'mock-maya/maya2025/bin/Render')
const MOCK_BLENDER = path.resolve(__dirname, 'mock-blender/blender-5.2/blender')
const MOCK_BLENDER45 = path.resolve(__dirname, 'mock-blender/blender-4.5/blender')
const BLEND_FIXTURES = path.resolve(__dirname, 'fixtures-blend')
for (const f of [MOCK, MOCK_BLENDER, MOCK_BLENDER45]) fs.chmodSync(f, 0o755)

const results: { name: string; ok: boolean; ms: number; err?: string }[] = []

async function test(name: string, fn: () => Promise<void>) {
  const t0 = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - t0 })
    console.log(`  PASS  ${name} (${Date.now() - t0}ms)`)
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: (e as Error).stack })
    console.log(`  FAIL  ${name}\n${(e as Error).stack}`)
  }
}

function tmp(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rd-${label}-`))
}

async function waitFor(cond: () => boolean, timeout = 30000, label = 'condition') {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function setup(label: string, scenes: [string, Parameters<typeof writeScene>[2]][], app: Partial<Engine['app']> = {}) {
  const root = tmp(label)
  const p = makeProject(root)
  for (const [name, o] of scenes) writeScene(p.scenes, name, o)
  const engine = new Engine({
    discoverInstalls: (paths) => paths.map(manualInstall).filter((install): install is Install => install !== null),
    dataDir: path.join(root, 'data'),
    dryRunPower: true,
    cores: 8,
    retryDelays: { license: 300, crash: 100, missing: 50 }
  })
  await engine.init()
  engine.addInstall(MOCK)
  engine.updateApp({ maxRetries: 2, ...app })
  engine.updateGlobal({ outputRoot: p.out, format: 'png' })
  engine.addPaths([p.scenes])
  await waitFor(() => engine.jobs.every((j) => j.info.state === 'done' || j.info.state === 'error'), 10000, 'probe')
  return { engine, ...p, root }
}

function putBlend(dir: string, name: string, fixture = 'basic', mock = 'speed=40'): string {
  const p = path.join(dir, `${name}.blend`)
  fs.copyFileSync(path.join(BLEND_FIXTURES, `${fixture}.blend`), p)
  fs.writeFileSync(`${p}.mock`, mock)
  return p
}

async function setupBlend(
  label: string,
  scenes: [string, string?, string?][],
  installs: string[] = [MOCK_BLENDER],
  app: Partial<Engine['app']> = {}
) {
  const root = tmp(label)
  const p = makeProject(root)
  for (const [name, fixture, mock] of scenes) putBlend(p.scenes, name, fixture, mock)
  const engine = new Engine({
    discoverInstalls: (paths) => paths.map(manualInstall).filter((install): install is Install => install !== null),
    dataDir: path.join(root, 'data'),
    dryRunPower: true,
    cores: 8,
    retryDelays: { license: 300, crash: 100, missing: 50 }
  })
  await engine.init()
  for (const i of installs) engine.addInstall(i)
  engine.updateApp({ maxRetries: 2, ...app })
  engine.updateGlobal({ outputRoot: p.out, format: 'png' })
  engine.addPaths([p.scenes])
  await waitFor(
    () => engine.jobs.length > 0 && engine.jobs.every((j) => j.info.state === 'done' || j.info.state === 'error'),
    15000,
    'probe'
  )
  return { engine, ...p, root }
}

async function runToEnd(engine: Engine, timeout = 60000) {
  engine.start()
  await waitFor(() => !engine.running && !engine.hasRunningWork(), timeout, 'run end')
}

function logText(engine: Engine, jobId: string | null): string {
  return engine
    .getLog(jobId)
    .map((l) => l.text)
    .join('\n')
}

async function main() {
  console.log('Render Farm engine tests')

  await test('utility: frame ranges and names', async () => {
    assert.deepEqual(toRanges([1, 2, 3, 5, 6, 9], 1, 0), [
      { start: 1, end: 3, step: 1 },
      { start: 5, end: 6, step: 1 },
      { start: 9, end: 9, step: 1 }
    ])
    assert.deepEqual(
      toRanges([1, 2, 3, 4, 5, 6, 7], 1, 3).map((r) => [r.start, r.end]),
      [
        [1, 3],
        [4, 6],
        [7, 7]
      ]
    )
    assert.deepEqual(
      toRanges([1, 3, 5, 9], 2, 0).map((r) => [r.start, r.end]),
      [
        [1, 5],
        [9, 9]
      ]
    )
    assert.equal(compactFrames([4, 5, 6, 9, 11, 12]), '4-6, 9, 11-12')
    assert.deepEqual(parseFrameName('S01_C010.0012.exr'), { stem: 'S01_C010', sep: '.', frame: 12, ext: 'exr', digits: 4 })
    assert.deepEqual(parseFrameName('beauty_0101.png'), { stem: 'beauty', sep: '_', frame: 101, ext: 'png', digits: 4 })
    assert.equal(parseFrameName('notes.txt'), null)
  })

  await test('probe: Maya ASCII scene analysis', async () => {
    const root = tmp('probe')
    const p = makeProject(root)
    const scene = writeScene(p.scenes, 'S01_C010', {
      start: 1001,
      end: 1048,
      timelineStart: 1001,
      timelineEnd: 1060,
      camera: 'shotCam',
      refs: ['assets/char_rig.mb', 'assets/missing_prop.mb'],
      layers: ['rs_charLayer']
    })
    const info = await probeAscii(scene)
    assert.equal(info.version, '2025')
    assert.equal(info.renderer, 'arnold')
    assert.equal(info.start, 1001)
    assert.equal(info.end, 1048)
    assert.equal(info.timelineEnd, 1060)
    assert.equal(info.width, 1920)
    assert.equal(info.fps, 24)
    assert.equal(info.imageFormat, 'exr')
    assert.deepEqual(
      info.cameras.filter((c) => c.renderable).map((c) => c.name),
      ['shotCam']
    )
    assert.ok(info.cameras.find((c) => c.name === 'persp' && !c.renderable))
    assert.deepEqual(
      info.layers.map((l) => l.name),
      ['defaultRenderLayer', 'rs_charLayer']
    )
    assert.ok(info.plugins.includes('mtoa'))
    assert.equal(info.references.length, 2)
  })

  await test('renderable default camera is flagged with a one-click fix', async () => {
    const { engine } = await setup('defcam', [['PERSP', { start: 1, end: 4, perspRenderable: true, mock: 'speed=10' }]])
    const job = engine.jobs[0]
    assert.deepEqual(
      job.info.cameras.filter((c) => c.renderable).map((c) => c.name),
      ['persp', 'shotCam']
    )
    assert.ok(job.info.cameras.find((c) => c.name === 'top' && !c.renderable))
    const issue = job.issues.find((i) => i.code === 'default-camera')
    assert.equal(issue?.fix?.patch?.camera, 'shotCam')
    engine.updateJobs([job.id], { overrides: issue!.fix!.patch })
    assert.ok(!job.issues.some((i) => i.code === 'default-camera'))
  })

  await test('sequential queue renders every scene to its own folder', async () => {
    const { engine, out } = await setup('seq', [
      ['S01_C010', { start: 1, end: 6, mock: 'speed=40' }],
      ['S01_C020', { start: 1, end: 4, mock: 'speed=40' }],
      ['S02_C010', { start: 10, end: 14, mock: 'speed=40' }]
    ])
    assert.equal(engine.jobs.length, 3)
    assert.ok(
      engine.jobs.every((j) => j.issues.every((i) => i.level !== 'error')),
      JSON.stringify(engine.jobs.map((j) => j.issues))
    )
    let maxParallel = 0
    const iv = setInterval(() => (maxParallel = Math.max(maxParallel, engine.stats().runningTasks)), 20)
    await runToEnd(engine)
    clearInterval(iv)
    assert.equal(maxParallel, 1)
    assert.deepEqual(
      engine.jobs.map((j) => j.status),
      ['done', 'done', 'done']
    )
    assert.equal(fs.readdirSync(path.join(out, 'S01_C010')).filter((f) => f.endsWith('.png')).length, 6)
    assert.ok(fs.existsSync(path.join(out, 'S02_C010', 'S02_C010.0014.png')))
    const log = logText(engine, engine.jobs[0].id)
    assert.match(log, /-proj/)
    assert.match(log, /-preRender rqBoot/)
    assert.match(log, /Maya 렌더 세션 시작 확인/)
    assert.equal(engine.stats().progress, 1)
  })

  await test('parallel mode runs two renders at once and splits threads', async () => {
    const { engine } = await setup(
      'par',
      [
        ['A', { end: 6, mock: 'speed=60' }],
        ['B', { end: 6, mock: 'speed=60' }],
        ['C', { end: 6, mock: 'speed=60' }]
      ],
      { concurrency: 2 }
    )
    let maxParallel = 0
    const iv = setInterval(() => (maxParallel = Math.max(maxParallel, engine.stats().runningTasks)), 20)
    await runToEnd(engine)
    clearInterval(iv)
    assert.equal(maxParallel, 2)
    assert.ok(engine.jobs.every((j) => j.status === 'done'))
    assert.match(logText(engine, engine.jobs[0].id), /-ai:threads 4/)
  })

  await test('chunked job spreads frame ranges across slots', async () => {
    const { engine } = await setup('chunk', [['LONG', { end: 12, mock: 'speed=30' }]], { concurrency: 3 })
    engine.updateGlobal({ chunkSize: 4 })
    let maxParallel = 0
    const iv = setInterval(() => (maxParallel = Math.max(maxParallel, engine.stats().runningTasks)), 20)
    await runToEnd(engine)
    clearInterval(iv)
    const job = engine.jobs[0]
    assert.equal(job.status, 'done')
    assert.equal(job.tasks.length, 3)
    assert.equal(maxParallel, 3)
    assert.equal(job.doneFrames.length, 12)
  })

  await test('crash mid-render retries only the missing frames', async () => {
    const { engine } = await setup('retry', [['CRASHY', { end: 8, mock: 'speed=30 fail=5 once' }]])
    await runToEnd(engine)
    const job = engine.jobs[0]
    assert.equal(job.status, 'done')
    assert.equal(job.tasks.length, 2)
    assert.equal(job.tasks[0].status, 'failed')
    assert.deepEqual([job.tasks[1].start, job.tasks[1].end, job.tasks[1].attempt], [5, 8, 1])
    assert.match(logText(engine, job.id), /빠진 프레임 재시도 예약/)
  })

  await test('persistent failure ends as partial with the missing frame list', async () => {
    const { engine } = await setup(
      'partial',
      [
        ['BROKEN', { end: 6, mock: 'speed=20 fail=4' }],
        ['OK', { end: 3, mock: 'speed=20' }]
      ],
      { maxRetries: 1 }
    )
    await runToEnd(engine)
    const [broken, ok] = engine.jobs
    assert.equal(broken.status, 'partial')
    assert.deepEqual(broken.missingFrames, [4, 5, 6])
    assert.deepEqual(broken.doneFrames, [1, 2, 3])
    assert.equal(ok.status, 'done')
    assert.match(broken.error ?? '', /4-6/)
  })

  await test('license failure never counts unrendered frames as done and waits before retrying', async () => {
    const { engine } = await setup('license', [['LIC', { start: 1, end: 8, mock: 'speed=10 license=5' }]], { maxRetries: 1 })
    const job = engine.jobs[0]
    engine.start()
    await waitFor(() => !engine.running, 30000)
    assert.equal(job.status, 'partial')
    assert.deepEqual(job.doneFrames, [1, 2, 3, 4])
    assert.deepEqual(job.missingFrames, [5, 6, 7, 8])
    assert.match(job.error ?? '', /라이선스/)
    const log = logText(engine, job.id)
    assert.match(log, /다시 렌더 예약 \(라이선스 대기 1\/3\)/)
    const failed = job.tasks.filter((t) => t.status === 'failed')
    assert.equal(failed.length, 4)
    assert.ok(failed[1].startedAt! - failed[0].finishedAt! >= 250)
    assert.ok(failed[2].startedAt! - failed[1].finishedAt! >= 550)
  })

  await test('license held by the previous render is waited out without showing errors', async () => {
    const { engine } = await setup(
      'licgap',
      [
        ['GA', { start: 1, end: 3, mock: 'speed=10 licgap=350' }],
        ['GB', { start: 4, end: 6, mock: 'speed=10 licgap=350' }]
      ],
      { maxRetries: 0 }
    )
    await runToEnd(engine)
    const [a, b] = engine.jobs
    assert.equal(a.status, 'done')
    assert.equal(b.status, 'done')
    assert.deepEqual(b.doneFrames, [4, 5, 6])
    const lines = [...engine.getLog(a.id), ...engine.getLog(b.id), ...engine.getLog(null)]
    assert.equal(lines.filter((l) => !l.raw && l.level === 'error').length, 0)
    assert.ok(lines.some((l) => l.raw && /abort_on_license_fail/.test(l.text)))
    assert.match(logText(engine, null), /렌더 사이 간격/)
  })

  await test('time estimate separates scene loading from frame time and survives a rerun', async () => {
    const { engine, scenes } = await setup('eta', [['ETA', { start: 1, end: 6, mock: 'speed=100' }]])
    await runToEnd(engine)
    const job = engine.jobs[0]
    assert.ok(job.avgFrameMs! >= 80 && job.avgFrameMs! < 400, `frame ${job.avgFrameMs}`)
    assert.ok(job.loadMs != null && job.loadMs < 2000, `load ${job.loadMs}`)
    engine.resetJobs([job.id], 'full')
    let st = engine.stats()
    assert.ok(st.etaMs! > 6 * 80, `eta ${st.etaMs}`)
    assert.equal(st.etaEstimated, false)
    writeScene(scenes, 'ETB', { start: 1, end: 3, mock: 'speed=100' })
    engine.addPaths([scenes])
    await waitFor(() => engine.jobs.every((j) => j.info.state === 'done'), 10000, 'probe')
    st = engine.stats()
    assert.equal(st.etaEstimated, true)
  })

  await test('blender: .blend scenes are read directly from the file', async () => {
    const { engine } = await setupBlend('blendprobe', [['B_SHOT'], ['B_OLD', 'basic45'], ['B_NOCAM', 'nocam']])
    const byName = (n: string) => engine.jobs.find((j) => j.sceneName === n)!
    const shot = byName('B_SHOT')
    assert.equal(shot.app, 'blender')
    assert.equal(shot.info.method, 'blend')
    assert.equal(shot.info.version, '5.2')
    assert.equal(shot.info.renderer, 'cycles')
    assert.deepEqual([shot.info.start, shot.info.end, shot.info.width, shot.info.height], [1, 6, 960, 540])
    assert.deepEqual(shot.info.cameras, [
      { name: 'CamA', renderable: true },
      { name: 'CamB', renderable: false }
    ])
    assert.deepEqual(shot.frames, [1, 2, 3, 4, 5, 6])
    assert.ok(shot.issues.some((i) => i.code === 'missing-textures' && /wood\.png/.test(i.message)))
    assert.ok(!shot.issues.some((i) => i.code === 'no-app' || i.code === 'non-ascii' || i.code === 'range-diff'))
    assert.equal(byName('B_OLD').info.version, '4.5')
    const nocam = byName('B_NOCAM')
    assert.ok(nocam.issues.some((i) => i.code === 'no-camera' && i.level === 'error'))
  })

  await test('blender: renders through Blender with frame markers and verified files', async () => {
    const { engine, out } = await setupBlend('blendrender', [['B_RUN', 'basic', 'speed=40']])
    const job = engine.jobs[0]
    await runToEnd(engine)
    assert.equal(job.status, 'done')
    assert.deepEqual(job.doneFrames, [1, 2, 3, 4, 5, 6])
    for (let f = 1; f <= 6; f++) assert.ok(fs.existsSync(path.join(out, 'B_RUN', `B_RUN.${String(f).padStart(4, '0')}.png`)))
    const log = logText(engine, job.id)
    assert.match(log, /Blender 렌더 세션 시작 확인/)
    assert.match(log, /렌더 장치: CPU/)
    assert.match(log, /명령: .*-b .*B_RUN\.blend --python .*rf_boot\.py -s 1 -e 6 -j 1 -a/)
    assert.ok(job.avgFrameMs! > 0 && job.versionUsed === '5.2')
  })

  await test('blender: crash mid-render retries only the missing frames', async () => {
    const { engine } = await setupBlend('blendcrash', [['B_CRASH', 'basic', 'speed=30 fail=4 once']])
    const job = engine.jobs[0]
    await runToEnd(engine)
    assert.equal(job.status, 'done')
    const failed = job.tasks.find((t) => t.status === 'failed')!
    assert.match(failed.error ?? '', /^종료 코드 1$/)
    const retry = job.tasks.find((t) => t.attempt === 1)!
    assert.deepEqual([retry.start, retry.end], [4, 6])
  })

  await test('blender and maya scenes share one queue', async () => {
    const { engine, scenes } = await setup('mixed', [['M_SHOT', { end: 3, mock: 'speed=20' }]])
    engine.addInstall(MOCK_BLENDER)
    putBlend(scenes, 'B_SHOT', 'basic', 'speed=20')
    engine.addPaths([scenes])
    await waitFor(() => engine.jobs.length === 2 && engine.jobs.every((j) => j.info.state === 'done'), 10000, 'probe')
    await runToEnd(engine)
    assert.deepEqual(engine.jobs.map((j) => `${j.app}:${j.status}`).sort(), ['blender:done', 'maya:done'])
  })

  await test('blender: older Blender than the scene is flagged and a broken file falls back to Blender analysis', async () => {
    const { engine, scenes } = await setupBlend('blendver', [['B_NEW']], [MOCK_BLENDER45])
    const job = engine.jobs[0]
    assert.ok(job.issues.some((i) => i.code === 'version-mismatch' && /Blender 5\.2.*Blender 4\.5/.test(i.message)))
    engine.addInstall(MOCK_BLENDER)
    assert.ok(!engine.jobs[0].issues.some((i) => i.code === 'version-mismatch'))
    const broken = path.join(scenes, 'B_BROKEN.blend')
    fs.writeFileSync(broken, Buffer.concat([Buffer.from('BLENDER-v405'), Buffer.alloc(64, 7)]))
    fs.writeFileSync(`${broken}.mock`, 'start=1 end=4')
    engine.addPaths([broken])
    await waitFor(() => engine.jobs.find((j) => j.sceneName === 'B_BROKEN')?.info.state === 'done', 10000, 'deep probe')
    const b = engine.jobs.find((j) => j.sceneName === 'B_BROKEN')!
    assert.equal(b.info.method, 'blender')
    assert.deepEqual(
      b.info.cameras.map((c) => c.name),
      ['ProbeCam']
    )
  })

  await test('AOV folders are judged by the beauty pass', async () => {
    const { engine } = await setup('aov', [['AOVS', { start: 1, end: 4, mock: 'speed=10 aovs=1 skipbeauty=3' }]], { maxRetries: 0 })
    await runToEnd(engine)
    const job = engine.jobs[0]
    assert.equal(job.status, 'partial')
    assert.deepEqual(job.missingFrames, [3])
    assert.match(engine.latestFrame(job.id)?.path ?? '', /beauty/)
  })

  await test('Windows crash codes are described in plain words', async () => {
    assert.equal(describeExit(3221226356, null), 'Render.exe 비정상 종료 (0xC0000374, 힙 손상)')
    assert.equal(describeExit(1, null), '종료 코드 1')
  })

  await test('frame written without markers is still detected and verified', async () => {
    const { engine } = await setup('nomark', [['NOMARK', { end: 5, mock: 'speed=40 markers=0' }]])
    await runToEnd(engine)
    assert.equal(engine.jobs[0].status, 'done')
    assert.deepEqual(engine.jobs[0].doneFrames, [1, 2, 3, 4, 5])
  })

  await test('missing output with clean exit is caught by verification', async () => {
    const { engine } = await setup('verify', [['GAP', { end: 5, mock: 'speed=20 skipwrite=3' }]], { maxRetries: 0 })
    await runToEnd(engine)
    const job = engine.jobs[0]
    assert.equal(job.status, 'partial')
    assert.deepEqual(job.missingFrames, [3])
  })

  await test('files landing outside the output folder fall back to Maya markers with a warning', async () => {
    const { engine } = await setup('elsewhere', [['ELSE', { end: 3, mock: 'speed=20 wrongdir=1' }]], { maxRetries: 0 })
    await runToEnd(engine)
    assert.equal(engine.jobs[0].status, 'done')
    assert.match(logText(engine, engine.jobs[0].id), /저장 경로 확인 필요/)
  })

  await test('stop then start resumes from unfinished frames', async () => {
    const { engine } = await setup('resume', [['RESUME', { end: 20, mock: 'speed=80' }]])
    engine.start()
    await waitFor(() => engine.jobs[0].doneFrames.length >= 4, 20000, 'some frames')
    engine.stop()
    await waitFor(() => !engine.hasRunningWork(), 10000, 'stopped')
    const job = engine.jobs[0]
    assert.equal(job.status, 'stopped')
    const doneBefore = job.doneFrames.length
    assert.ok(doneBefore >= 4 && doneBefore < 20)
    await runToEnd(engine)
    assert.equal(job.status, 'done')
    const firstStart = job.tasks[0].start
    assert.ok(firstStart > 1, `resumed at ${firstStart}`)
    assert.equal(job.doneFrames.length, 20)
  })

  await test('state survives an app restart and interrupted jobs resume', async () => {
    const { engine, root } = await setup('restart', [['PERSIST', { end: 16, mock: 'speed=80' }]])
    engine.start()
    await waitFor(() => engine.jobs[0].doneFrames.length >= 3, 20000, 'frames')
    await engine.shutdown()
    await waitFor(() => engine.stats().runningTasks === 0, 10000, 'killed')
    const again = new Engine({
      discoverInstalls: (paths) => paths.map(manualInstall).filter((install): install is Install => install !== null),
      dataDir: path.join(root, 'data'),
      dryRunPower: true,
      cores: 8
    })
    await again.init()
    const job = again.jobs[0]
    assert.equal(job.status, 'stopped')
    assert.ok(job.doneFrames.length >= 3)
    await runToEnd(again)
    assert.equal(again.jobs[0].status, 'done')
    assert.ok(again.jobs[0].tasks[0].start > 1)
  })

  await test('skip existing frames renders only what is absent', async () => {
    const { engine, out } = await setup('skip', [['SKIP', { end: 8, mock: 'speed=20' }]])
    fs.mkdirSync(path.join(out, 'SKIP'), { recursive: true })
    for (const f of [1, 2, 3, 6]) fs.writeFileSync(path.join(out, 'SKIP', `SKIP.${String(f).padStart(4, '0')}.png`), 'x')
    engine.updateGlobal({ skipExisting: true })
    await runToEnd(engine)
    const job = engine.jobs[0]
    assert.equal(job.status, 'done')
    assert.deepEqual(
      job.tasks.map((t) => [t.start, t.end]),
      [
        [4, 5],
        [7, 8]
      ]
    )
  })

  await test('per-scene overrides change frames, camera and resolution', async () => {
    const { engine, out } = await setup('override', [['OVR', { start: 1, end: 30, mock: 'speed=10' }]])
    const job = engine.jobs[0]
    engine.updateJobs([job.id], {
      overrides: {
        frameMode: 'custom',
        start: 5,
        end: 9,
        step: 2,
        camera: 'shotCam',
        resolutionMode: 'custom',
        width: 1280,
        height: 720,
        filePrefix: '{scene}_{camera}'
      }
    })
    await runToEnd(engine)
    assert.equal(job.status, 'done')
    assert.deepEqual(job.frames, [5, 7, 9])
    const log = logText(engine, job.id)
    assert.match(log, /-cam shotCam/)
    assert.match(log, /-x 1280 -y 720/)
    assert.match(log, /-b 2/)
    assert.ok(fs.existsSync(path.join(out, 'OVR', 'OVR_shotCam.0009.png')))
  })

  await test('preflight flags collisions, range mismatch, missing refs and non-ASCII paths', async () => {
    const root = tmp('preflight')
    const p = makeProject(root)
    const unicodeDir = path.join(p.scenes, 'café')
    fs.mkdirSync(unicodeDir)
    writeScene(unicodeDir, 'K01', { start: 1, end: 10, timelineEnd: 96, refs: ['assets/gone.mb'] })
    const engine = new Engine({
      discoverInstalls: (paths) => paths.map(manualInstall).filter((install): install is Install => install !== null),
      dataDir: path.join(root, 'data'),
      dryRunPower: true
    })
    await engine.init()
    engine.addPaths([p.scenes])
    await waitFor(() => engine.jobs.every((j) => j.info.state === 'done'))
    let codes = engine.jobs[0].issues.map((i) => i.code)
    assert.ok(codes.includes('no-output'))
    assert.ok(codes.includes('range-diff'))
    assert.ok(codes.includes('missing-refs'))
    assert.ok(codes.includes('non-ascii'))
    assert.match(engine.jobs[0].issues.find((i) => i.code === 'non-ascii')!.message, /씬 파일 경로.*café/)
    engine.updateGlobal({ outputRoot: p.out })
    engine.duplicateJobs([engine.jobs[0].id])
    codes = engine.jobs[1].issues.map((i) => i.code)
    assert.ok(codes.includes('collision'))
    engine.addInstall(MOCK)
    engine.updateJobs([engine.jobs[1].id], { overrides: { filePrefix: '{scene}_v2' } })
    assert.ok(!engine.jobs[1].issues.some((i) => i.code === 'collision'))
  })

  await test('blocking issue fails that job and the queue moves on', async () => {
    const { engine } = await setup('block', [['GOOD', { end: 3, mock: 'speed=20' }]])
    const bad = path.join(path.dirname(engine.jobs[0].scenePath), 'GONE.ma')
    fs.writeFileSync(bad, '//Maya ASCII 2025 scene\n')
    engine.addPaths([bad])
    await waitFor(() => engine.jobs.every((j) => j.info.state === 'done'))
    fs.rmSync(bad)
    engine.reorderJobs([engine.jobs[1].id, engine.jobs[0].id])
    await runToEnd(engine)
    assert.equal(engine.jobs[0].status, 'failed')
    assert.equal(engine.jobs[1].status, 'done')
  })

  await test('completion action counts down and fires after the queue', async () => {
    const { engine } = await setup('shutdown', [['LAST', { end: 2, mock: 'speed=20' }]], {
      completionAction: 'shutdown',
      countdownSeconds: 5
    })
    await runToEnd(engine)
    assert.equal(engine.completion.pendingAction, 'shutdown')
    assert.ok((engine.completion.countdown ?? 0) > 0)
    await waitFor(() => engine.completion.pendingAction === null, 8000, 'countdown')
    assert.match(logText(engine, null), /\[테스트 모드\] (shutdown|systemctl poweroff|osascript)/)
  })

  await test('cancelled countdown never fires and stop never triggers shutdown', async () => {
    const { engine } = await setup(
      'cancel',
      [
        ['X', { end: 2, mock: 'speed=20' }],
        ['Y', { end: 40, mock: 'speed=80' }]
      ],
      { completionAction: 'shutdown', countdownSeconds: 5 }
    )
    engine.start()
    await waitFor(() => engine.jobs[0].status === 'done', 10000)
    engine.stop()
    await waitFor(() => !engine.hasRunningWork(), 10000)
    assert.equal(engine.completion.pendingAction, null)
    engine.resetJobs([engine.jobs[1].id], 'full')
    engine.updateJobs([engine.jobs[1].id], { overrides: { frameMode: 'custom', start: 1, end: 2 } })
    await runToEnd(engine)
    assert.equal(engine.completion.pendingAction, 'shutdown')
    engine.cancelCountdown()
    await new Promise((r) => setTimeout(r, 1200))
    assert.doesNotMatch(logText(engine, null), /테스트 모드/)
  })

  await test('range warning offers a one-click timeline fix and can be dismissed', async () => {
    const { engine } = await setup('fix', [
      ['TRAP', { start: 1, end: 10, timelineStart: 1, timelineEnd: 48, mock: 'speed=10' }],
      ['ANIMOFF', { start: 1, end: 10, timelineEnd: 24, animation: false, mock: 'speed=10' }]
    ])
    const trap = engine.jobs.find((j) => j.sceneName === 'TRAP')!
    const off = engine.jobs.find((j) => j.sceneName === 'ANIMOFF')!
    const issue = trap.issues.find((i) => i.code === 'range-diff')
    assert.ok(issue?.fix?.patch)
    assert.ok(off.issues.some((i) => i.code === 'anim-off'))
    engine.updateJobs([trap.id], { overrides: issue!.fix!.patch })
    assert.equal(trap.frames.length, 48)
    assert.ok(!trap.issues.some((i) => i.code === 'range-diff'))
    engine.updateJobs([off.id], { dismiss: ['anim-off'] })
    assert.ok(!off.issues.some((i) => i.code === 'anim-off'))
    assert.equal(off.frames.length, 10)
  })

  await test('settings lock limits students to scene-level choices', async () => {
    const { engine, out } = await setup('lock', [['L1', { end: 3, mock: 'speed=10' }]])
    engine.updateGlobal({ outputRoot: out, format: 'exr' })
    assert.ok(engine.setPin('2580'))
    engine.lockNow()
    assert.equal(engine.snapshot().lock.locked, true)
    engine.updateGlobal({ format: 'png', outputRoot: '/elsewhere' })
    assert.equal(engine.global.format, 'exr')
    assert.equal(engine.global.outputRoot, out)
    const job = engine.jobs[0]
    engine.updateJobs([job.id], { overrides: { format: 'jpg', frameMode: 'custom', start: 1, end: 2 } })
    assert.equal(job.overrides.format, undefined)
    assert.equal(job.overrides.frameMode, 'custom')
    engine.updateApp({ concurrency: 4, completionAction: 'shutdown', lockPinHash: '' } as never)
    assert.equal(engine.app.concurrency, 1)
    assert.equal(engine.app.completionAction, 'shutdown')
    assert.ok(engine.app.lockPinHash)
    assert.equal(engine.unlock('0000'), false)
    assert.equal(engine.unlock('2580'), true)
    engine.updateGlobal({ format: 'png' })
    assert.equal(engine.global.format, 'png')
    engine.setPin(null)
    assert.equal(engine.snapshot().lock.enabled, false)
  })

  await test('skip moves the queue to the next job', async () => {
    const { engine } = await setup('skipjob', [
      ['A_SLOW', { end: 40, mock: 'speed=100' }],
      ['B_NEXT', { end: 2, mock: 'speed=20' }]
    ])
    const byName = (n: string) => engine.jobs.find((j) => j.sceneName === n)!
    engine.start()
    await waitFor(() => byName('A_SLOW').doneFrames.length >= 1, 10000)
    engine.skip([byName('A_SLOW').id])
    await waitFor(() => !engine.running && !engine.hasRunningWork(), 20000)
    assert.equal(byName('A_SLOW').status, 'skipped')
    assert.equal(byName('B_NEXT').status, 'done')
  })

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}

main()
