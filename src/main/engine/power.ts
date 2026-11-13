import { execFile } from 'node:child_process'
import type { CompletionAction } from '../../shared/types'

export function powerCommand(
  action: CompletionAction,
  platform: NodeJS.Platform = process.platform
): { cmd: string; args: string[] } | null {
  const p = platform
  if (action === 'shutdown') {
    if (p === 'win32') return { cmd: 'shutdown', args: ['/s', '/t', '0'] }
    if (p === 'darwin') return { cmd: 'osascript', args: ['-e', 'tell app "System Events" to shut down'] }
    return { cmd: 'systemctl', args: ['poweroff'] }
  }
  if (action === 'sleep') {
    if (p === 'win32') return { cmd: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] }
    if (p === 'darwin') return { cmd: 'pmset', args: ['sleepnow'] }
    return { cmd: 'systemctl', args: ['suspend'] }
  }
  return null
}

export function runPowerAction(action: CompletionAction, dryRun: boolean): Promise<string> {
  const c = powerCommand(action)
  if (!c) return Promise.resolve('')
  const line = `${c.cmd} ${c.args.join(' ')}`
  if (dryRun) return Promise.resolve(`[테스트 모드] ${line}`)
  return new Promise((resolve, reject) => {
    execFile(c.cmd, c.args, { windowsHide: true }, (err) => (err ? reject(err) : resolve(line)))
  })
}
