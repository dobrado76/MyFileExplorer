import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { DEV_CFG_FILE, isDevCfgOpen, parseDevCfg } from '@shared/devGate'
import { localComputerNames } from './fs/networkShared'

let cached: boolean | null = null

export function isDevGateActive(): boolean {
  if (cached != null) return cached
  cached = readDevGateActive()
  return cached
}

/** Re-read DEV.cfg (e.g. after manual edit while app is open). */
export function refreshDevGateCache(): boolean {
  cached = readDevGateActive()
  return cached
}

function readDevGateActive(): boolean {
  const cfgPath = path.join(app.getPath('userData'), DEV_CFG_FILE)
  if (!fs.existsSync(cfgPath)) return false
  try {
    const parsed = parseDevCfg(fs.readFileSync(cfgPath, 'utf8'))
    if (!parsed) return false
    return isDevCfgOpen(parsed, localComputerNames())
  } catch {
    return false
  }
}
