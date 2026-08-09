import { expandWindowsEnvVars } from '@shared/expandEnvPath'

/** Main-process lookup: `process.env` (case-insensitive match). */
export function lookupProcessEnv(name: string): string | undefined {
  const direct = process.env[name]
  if (typeof direct === 'string' && direct !== '') return direct
  const want = name.toLowerCase()
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toLowerCase() === want && typeof v === 'string' && v !== '') return v
  }
  return undefined
}

export function expandWindowsEnvPath(input: string): string {
  return expandWindowsEnvVars(input, lookupProcessEnv)
}
