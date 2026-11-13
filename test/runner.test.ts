import assert from 'node:assert/strict'
import { once } from 'node:events'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { RenderProcess, type RunnerEvent } from '../src/main/engine/runner'

function nodeProcess(script: string) {
  return new RenderProcess(process.execPath, ['-e', script], process.env, os.tmpdir(), 'utf8')
}

test('partial stdout and stderr lines cannot corrupt each other', async () => {
  const proc = nodeProcess(
    `process.stdout.write('@@RQ:FRAME_'); setTimeout(() => process.stderr.write('Warning: test\\n'), 30); setTimeout(() => process.stdout.write('END 7\\n'), 60)`
  )
  const events: RunnerEvent[] = []
  proc.on('event', (e) => events.push(e))
  const done = once(proc, 'exit')
  proc.start()
  await done
  assert.ok(events.some((e) => e.type === 'frameEnd' && e.frame === 7))
  assert.ok(events.some((e) => e.type === 'line' && e.text === 'Warning: test' && e.level === 'warn'))
})

test('an unavailable executable reports one exit event', async () => {
  const proc = new RenderProcess(path.join(os.tmpdir(), 'render-farm-nonexistent-executable'), [], process.env, os.tmpdir(), 'utf8')
  let exits = 0
  proc.on('exit', () => exits++)
  const done = once(proc, 'exit')
  proc.start()
  assert.equal((await done)[0], -1)
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(exits, 1)
})

test('stop waits for a live renderer to close and is safe to repeat', async () => {
  const proc = nodeProcess(`console.log('ready'); setInterval(() => {}, 1000)`)
  const ready = once(proc, 'event')
  proc.start()
  await ready
  await proc.stop()
  assert.ok(proc.killed)
  assert.ok(proc.child?.exitCode !== null || proc.child?.signalCode !== null)
  await proc.stop()
})
