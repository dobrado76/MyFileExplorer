import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  applyDevCfgEnable,
  DEV_CFG_FILE,
  isDevCfgOpen,
  parseDevCfg,
  parseDevCfgEnable
} from '@shared/devGate'
import { AppError } from '@shared/result'
import { localComputerNames } from './fs/networkShared'
import { broadcast } from './ipc/events'

export type DevGateStatus = {
  /** File exists under userData. Toggle visibility uses this only. */
  present: boolean
  /** ENABLE field (false if missing). */
  enable: boolean
  /** ENABLE and COMPUTER_NAME match this machine. */
  active: boolean
}

let cachedActive: boolean | null = null

export function devCfgPath(): string {
  return path.join(app.getPath('userData'), DEV_CFG_FILE)
}

export function isDevGateActive(): boolean {
  if (cachedActive != null) return cachedActive
  cachedActive = readDevGateActive()
  return cachedActive
}

/** Re-read DEV.cfg (e.g. after manual edit while app is open). */
export function refreshDevGateCache(): boolean {
  cachedActive = readDevGateActive()
  return cachedActive
}

export function getDevGateStatus(): DevGateStatus {
  const cfgPath = devCfgPath()
  if (!fs.existsSync(cfgPath)) {
    cachedActive = false
    return { present: false, enable: false, active: false }
  }
  try {
    const text = fs.readFileSync(cfgPath, 'utf8')
    const enable = parseDevCfgEnable(text)
    const parsed = parseDevCfg(text)
    const active = parsed != null && isDevCfgOpen(parsed, localComputerNames())
    cachedActive = active
    return { present: true, enable, active }
  } catch {
    cachedActive = false
    return { present: true, enable: false, active: false }
  }
}

/** Write ENABLE in the existing file. Never creates DEV.cfg. */
export function setDevGateEnable(enable: boolean): DevGateStatus {
  const cfgPath = devCfgPath()
  if (!fs.existsSync(cfgPath)) {
    cachedActive = false
    const status = { present: false, enable: false, active: false }
    broadcast({ type: 'dev-gate', payload: status })
    return status
  }
  try {
    const text = fs.readFileSync(cfgPath, 'utf8')
    fs.writeFileSync(cfgPath, applyDevCfgEnable(text, enable), 'utf8')
  } catch (e) {
    throw new AppError(
      'io',
      `Could not write DEV.cfg: ${e instanceof Error ? e.message : String(e)}`
    )
  }
  const status = getDevGateStatus()
  broadcast({ type: 'dev-gate', payload: status })
  return status
}

function readDevGateActive(): boolean {
  return getDevGateStatus().active
}
