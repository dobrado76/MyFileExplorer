import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { UsnRecentEntry } from '@shared/schemas/usn'
import { logMain } from '../logging'
import {
  closeHandle,
  openVolumeHandle,
  queryUsnJournal
} from '../search/ntfs/usnNative'
import { readRecentFromHandle } from '../search/ntfs/usnRecentRead'

export const USN_RECENT_CLI_FLAG = '--usn-recent'

export type UsnRecentCliArgs = { letter: string; outFile: string }

export type UsnRecentCliResult = {
  ok: boolean
  entries: UsnRecentEntry[]
  error?: string
  err?: number
}

export function parseUsnRecentCli(argv: string[]): UsnRecentCliArgs | null {
  const i = argv.indexOf(USN_RECENT_CLI_FLAG)
  if (i < 0) return null
  const letterRaw = argv[i + 1]?.trim() ?? ''
  const outFile = argv[i + 2]?.trim() ?? ''
  const letter = /^[a-zA-Z]:$/.test(letterRaw) ? letterRaw.toUpperCase() : null
  if (!letter || !outFile || !path.isAbsolute(outFile) || !outFile.toLowerCase().endsWith('.json')) {
    return null
  }
  return { letter, outFile }
}

export function runUsnRecentCli(letter: string, outFile: string): number {
  const writeResult = (result: UsnRecentCliResult): void => {
    mkdirSync(path.dirname(outFile), { recursive: true })
    writeFileSync(outFile, JSON.stringify(result), 'utf8')
  }
  const writeOpen = openVolumeHandle(letter, true)
  const opened = writeOpen.handle ? writeOpen : openVolumeHandle(letter, false)
  if (!opened.handle) {
    writeResult({
      ok: false,
      entries: [],
      error: `Could not open ${letter} (Windows error ${opened.err})`,
      err: opened.err
    })
    return 1
  }
  try {
    const info = queryUsnJournal(opened.handle)
    if (!info) {
      writeResult({ ok: false, entries: [], error: `Could not query the USN journal on ${letter}` })
      return 1
    }
    const { entries, err } = readRecentFromHandle(opened.handle, info, 200)
    writeResult({
      ok: entries.length > 0,
      entries,
      err,
      error: entries.length ? undefined : `No records readable on ${letter} (Windows error ${err})`
    })
    logMain('info', `USN recent CLI: ${entries.length} record(s) on ${letter}`)
    return 0
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    writeResult({ ok: false, entries: [], error: message })
    logMain('warn', `USN recent CLI failed: ${message}`)
    return 1
  } finally {
    closeHandle(opened.handle)
  }
}
