import fs from 'node:fs'
import path from 'node:path'

export function resolveDataDir(appData: string, override?: string): string {
  if (override) return path.resolve(override)
  const previous = ['RenderFarm', 'renderfarm'].map((name) => path.join(appData, name))
  const entries = fs.existsSync(appData) ? fs.readdirSync(appData) : []
  return previous.find((dir) => entries.includes(path.basename(dir)) && fs.existsSync(path.join(dir, 'state.json'))) ?? previous[0]
}
