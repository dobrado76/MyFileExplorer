/** Local gate file name under Electron userData (never shipped). */
export const DEV_CFG_FILE = 'DEV.cfg'

export type DevCfgFields = {
  enable: boolean
  computerName: string
}

/** Parse DEV.cfg key=value lines (ENABLE, COMPUTER_NAME). Returns null when empty/invalid. */
export function parseDevCfg(text: string): DevCfgFields | null {
  let enable: boolean | undefined
  let computerName: string | undefined

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim().toUpperCase()
    const val = trimmed.slice(eq + 1).trim()
    if (key === 'ENABLE') enable = /^(true|1|yes|on)$/i.test(val)
    else if (key === 'COMPUTER_NAME') computerName = val
  }

  if (enable == null || computerName == null || !computerName.trim()) return null
  return { enable, computerName: computerName.trim() }
}

export function normalizeComputerName(name: string): string {
  return name.trim().split('.')[0]!.toLowerCase()
}

/** True when configured name matches any local host identifier (case-insensitive). */
export function devCfgMatchesComputerName(configured: string, localNames: readonly string[]): boolean {
  const want = normalizeComputerName(configured)
  if (!want) return false
  return localNames.some((n) => normalizeComputerName(n) === want)
}

/** All three gate conditions except file existence (handled in main). */
export function isDevCfgOpen(cfg: DevCfgFields, localNames: readonly string[]): boolean {
  return cfg.enable === true && devCfgMatchesComputerName(cfg.computerName, localNames)
}
