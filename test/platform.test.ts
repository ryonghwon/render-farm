import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveDataDir } from '../src/main/data-directory'
import { installPathKey, manualInstall } from '../src/main/engine/installs'
import { powerCommand } from '../src/main/engine/power'

test('renaming the app retains the existing queue and settings directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-farm-data-'))
  try {
    assert.equal(resolveDataDir(root), path.join(root, 'RenderFarm'))
    const old = path.join(root, 'renderfarm')
    fs.mkdirSync(old)
    fs.writeFileSync(path.join(old, 'state.json'), '{}')
    assert.equal(fs.realpathSync(resolveDataDir(root)), fs.realpathSync(old))
    assert.equal(resolveDataDir(root, path.join(root, 'custom')), path.join(root, 'custom'))
    assert.equal(fs.readFileSync(path.join(old, 'state.json'), 'utf8'), '{}')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('executable identity ignores case only on Windows', () => {
  assert.equal(installPathKey('C:\\Apps\\Maya\\Render.exe', 'win32'), installPathKey('c:\\apps\\maya\\render.exe', 'win32'))
  assert.notEqual(installPathKey('/Apps/Maya/Render', 'darwin'), installPathKey('/apps/maya/render', 'darwin'))
})

test('manual installations resolve Mac application bundles and reject unrelated files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-farm-app-'))
  try {
    const bundle = path.join(root, 'maya2025', 'Maya.app')
    const bin = path.join(bundle, 'Contents', 'bin')
    fs.mkdirSync(bin, { recursive: true })
    const render = path.join(bin, 'Render')
    fs.writeFileSync(render, '')
    fs.writeFileSync(path.join(root, 'unrelated.exe'), '')
    assert.equal(manualInstall(bundle)?.renderPath, render)
    assert.equal(manualInstall(bundle)?.version, '2025')
    assert.equal(manualInstall(path.join(root, 'unrelated.exe')), null)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('completion commands select the host platform without running them', () => {
  assert.deepEqual(powerCommand('shutdown', 'win32'), { cmd: 'shutdown', args: ['/s', '/t', '0'] })
  assert.deepEqual(powerCommand('sleep', 'darwin'), { cmd: 'pmset', args: ['sleepnow'] })
  assert.equal(powerCommand('shutdown', 'darwin')?.cmd, 'osascript')
  assert.equal(powerCommand('none', 'darwin'), null)
  assert.equal(powerCommand('quit', 'win32'), null)
})
