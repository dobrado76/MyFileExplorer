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

/** ENABLE line only — missing / invalid is false. Does not require COMPUTER_NAME. */
export function parseDevCfgEnable(text: string): boolean {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim().toUpperCase()
    if (key === 'ENABLE') return /^(true|1|yes|on)$/i.test(trimmed.slice(eq + 1).trim())
  }
  return false
}

/** Replace or insert ENABLE=true|false; keep other lines (COMPUTER_NAME, comments). */
export function applyDevCfgEnable(text: string, enable: boolean): string {
  const enableLine = `ENABLE=${enable ? 'true' : 'false'}`
  const endsWithNl = /\r?\n$/.test(text)
  const lines = text.length === 0 ? [] : text.split(/\r?\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  let found = false
  const next = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) return line
    const eq = trimmed.indexOf('=')
    if (eq < 0) return line
    if (trimmed.slice(0, eq).trim().toUpperCase() !== 'ENABLE') return line
    found = true
    return enableLine
  })
  if (!found) next.unshift(enableLine)
  const body = next.join('\n')
  return endsWithNl || text.length === 0 ? `${body}\n` : body
}
