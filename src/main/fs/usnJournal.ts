import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AppError } from '@shared/result'
import {
  clampUsnJournalSizes,
  driveLetterLabel,
  isUsnJournalAbsentMessage,
  isUsnJournalDeletingMessage,
  parseFsutilUsnQuery,
  resolveUsnProbeDir,
  sameVolumePrefix,
  usnProbeFileName
} from '@shared/usn/format'
import type { UsnQueryResponse, UsnRecentEntry } from '@shared/schemas/usn'
import { requireAbsolute } from './list'
import { isDriveRoot, readVolumeFileSystem } from './properties'
import {
  closeHandle,
  createUsnJournal,
  deleteUsnJournal,
  needsUsnElevation,
  openVolumeHandle,
  queryUsnJournal,
  queryUsnJournalEx,
  volumeLetterFromRoot,
  WINERR_JOURNAL_DELETE_IN_PROGRESS,
  WINERR_JOURNAL_NOT_ACTIVE,
  type UsnJournalInfo
} from '../search/ntfs/usnNative'
import { readRecentFromHandle } from '../search/ntfs/usnRecentRead'
import { USN_RECENT_CLI_FLAG } from './usnRecentCli'
import { logMain } from '../logging'

function requireDriveRoot(raw: string): { abs: string; letter: string } {
  const abs = requireAbsolute(raw)
  if (!isDriveRoot(abs)) {
    throw new AppError('validation', 'USN journal can only be managed on a drive root (for example C:\\)')
  }
  const letter = volumeLetterFromRoot(abs)
  if (!letter) {
    throw new AppError('validation', `Not a drive root: ${abs}`)
  }
  return { abs, letter }
}

function infoToDto(info: UsnJournalInfo) {
  return {
    journalId: info.journalId.toString(),
    firstUsn: info.firstUsn.toString(),
    nextUsn: info.nextUsn.toString(),
    lowestValidUsn: info.lowestValidUsn.toString(),
    maxUsn: info.maxUsn.toString(),
    maximumSize: info.maximumSize.toString(),
    allocationDelta: info.allocationDelta.toString()
  }
}

function queryWithHandle(letter: string, write: boolean): {
  info: UsnJournalInfo | null
  err: number
  opened: boolean
} {
  const opened = openVolumeHandle(letter, write)
  if (!opened.handle) return { info: null, err: opened.err, opened: false }
  try {
    return { ...queryUsnJournalEx(opened.handle), opened: true }
  } finally {
    closeHandle(opened.handle)
  }
}

function runFsutilQuery(letter: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const child = spawn('fsutil.exe', ['usn', 'queryjournal', letter], {
      windowsHide: true
    })
    child.stdout?.on('data', (d: Buffer) => chunks.push(d))
    child.stderr?.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', reject)
    child.on('exit', (code) => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (code === 0) resolve(text)
      else reject(new Error(text.trim() || `fsutil queryjournal exited ${code}`))
    })
  })
}

async function queryUsnJournalViaFsutil(
  letter: string
): Promise<UsnJournalInfo | 'absent' | 'deleting' | null> {
  try {
    const text = await runFsutilQuery(letter)
    if (isUsnJournalDeletingMessage(text)) return 'deleting'
    const parsed = parseFsutilUsnQuery(text)
    return parsed
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isUsnJournalDeletingMessage(msg)) return 'deleting'
    if (isUsnJournalAbsentMessage(msg)) return 'absent'
    logMain('warn', `USN: fsutil queryjournal ${letter} failed: ${msg}`)
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitUntilJournalNotDeleting(
  rawPath: string,
  timeoutMs = 90_000
): Promise<UsnQueryResponse> {
  const started = Date.now()
  let last = await queryUsnJournalForPath(rawPath)
  while (last.status === 'deleting' && Date.now() - started < timeoutMs) {
    logMain('info', `USN: waiting for journal delete to finish on ${last.letter}`)
    await delay(4000)
    last = await queryUsnJournalForPath(rawPath)
  }
  return last
}

export async function queryUsnJournalForPath(rawPath: string): Promise<UsnQueryResponse> {
  if (process.platform !== 'win32') {
    return {
      status: 'unsupported',
      letter: driveLetterLabel(rawPath),
      fileSystem: null,
      journal: null,
      needsElevation: false
    }
  }
  const { abs, letter } = requireDriveRoot(rawPath)
  const fileSystem = await readVolumeFileSystem(abs)
  if (fileSystem && fileSystem.toUpperCase() !== 'NTFS') {
    return {
      status: 'not-ntfs',
      letter,
      fileSystem,
      journal: null,
      needsElevation: false
    }
  }

  const { info, err, opened } = queryWithHandle(letter, false)
  if (info) {
    return {
      status: 'active',
      letter,
      fileSystem,
      journal: infoToDto(info),
      needsElevation: false
    }
  }

  // Native already knows — do not pile fsutil I/O onto an in-progress volume scan.
  if (err === WINERR_JOURNAL_DELETE_IN_PROGRESS) {
    return {
      status: 'deleting',
      letter,
      fileSystem,
      journal: null,
      needsElevation: false
    }
  }
  if (err === WINERR_JOURNAL_NOT_ACTIVE) {
    return {
      status: 'absent',
      letter,
      fileSystem,
      journal: null,
      needsElevation: false
    }
  }

  const viaFsutil = await queryUsnJournalViaFsutil(letter)
  if (viaFsutil && viaFsutil !== 'absent' && viaFsutil !== 'deleting') {
    return {
      status: 'active',
      letter,
      fileSystem,
      journal: infoToDto(viaFsutil),
      needsElevation: false
    }
  }

  if (viaFsutil === 'deleting') {
    return {
      status: 'deleting',
      letter,
      fileSystem,
      journal: null,
      needsElevation: false
    }
  }

  if (viaFsutil === 'absent') {
    return {
      status: 'absent',
      letter,
      fileSystem,
      journal: null,
      needsElevation: false
    }
  }
  if (!opened && needsUsnElevation(err)) {
    return {
      status: 'access-denied',
      letter,
      fileSystem,
      journal: null,
      needsElevation: true
    }
  }
  if (needsUsnElevation(err)) {
    return {
      status: 'access-denied',
      letter,
      fileSystem,
      journal: null,
      needsElevation: true
    }
  }
  return {
    status: 'absent',
    letter,
    fileSystem,
    journal: null,
    needsElevation: false
  }
}

function runElevatedUsnRecent(outFile: string, letter: string): Promise<void> {
  const exe = process.execPath.replace(/'/g, "''")
  const cwd = (app.isPackaged ? path.dirname(process.execPath) : process.cwd()).replace(/'/g, "''")
  const args = app.isPackaged
    ? [USN_RECENT_CLI_FLAG, letter, outFile]
    : [path.resolve(process.argv[1] ?? '.'), USN_RECENT_CLI_FLAG, letter, outFile]
  const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  const ps = `$p = Start-Process -FilePath '${exe}' -ArgumentList @(${argList}) -WorkingDirectory '${cwd}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru; if ($null -eq $p) { exit 1 }; exit $p.ExitCode`
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], {
      windowsHide: true
    })
    child.on('error', (e) => {
      reject(
        new AppError(
          'io',
          e instanceof Error ? e.message : String(e),
          'Retry as administrator'
        )
      )
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else {
        reject(
          new AppError(
            'not-allowed',
            code == null
              ? 'Administrator USN read failed or was cancelled'
              : `Administrator USN read failed or was cancelled (exit ${code})`,
            'Retry as administrator'
          )
        )
      }
    })
  })
}

function runFsutilElevated(args: string[]): Promise<void> {
  const argList = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(',')
  // -PassThru + exit $p.ExitCode: Start-Process -Wait alone exits 0 even when fsutil fails.
  const ps = `$p = Start-Process -FilePath fsutil.exe -ArgumentList @(${argList}) -Verb RunAs -Wait -WindowStyle Hidden -PassThru; if ($null -eq $p) { exit 1 }; exit $p.ExitCode`
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], {
      windowsHide: true
    })
    child.on('error', (e) => {
      reject(
        new AppError(
          'io',
          e instanceof Error ? e.message : String(e),
          'Retry as administrator'
        )
      )
    })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else {
        reject(
          new AppError(
            'not-allowed',
            code == null
              ? 'Elevated USN command failed or was cancelled'
              : `Elevated USN command failed or was cancelled (exit ${code})`,
            'Retry as administrator'
          )
        )
      }
    })
  })
}

async function mutateNative(
  letter: string,
  fn: (h: unknown, info: UsnJournalInfo | null) => { ok: boolean; err: number }
): Promise<{ status: 'ok' | 'denied' | 'fail'; err: number }> {
  const opened = openVolumeHandle(letter, true)
  if (!opened.handle) {
    return {
      status: needsUsnElevation(opened.err) ? 'denied' : 'fail',
      err: opened.err
    }
  }
  try {
    const info = queryUsnJournal(opened.handle)
    const result = fn(opened.handle, info)
    if (result.ok) return { status: 'ok', err: 0 }
    return {
      status: needsUsnElevation(result.err) ? 'denied' : 'fail',
      err: result.err
    }
  } finally {
    closeHandle(opened.handle)
  }
}

function mutateDeniedError(action: string, letter: string, err: number): AppError {
  return new AppError(
    'not-allowed',
    `Administrator permission is required to ${action} the USN journal on ${letter}` +
      (err ? ` (Windows error ${err})` : ''),
    'Retry as administrator'
  )
}

function mutateFailError(action: string, letter: string, err: number): AppError {
  return new AppError(
    'not-allowed',
    `Could not ${action} the USN journal on ${letter}` + (err ? ` (Windows error ${err})` : ''),
    'Retry as administrator'
  )
}

async function probeJournalWithTestFile(volumeRoot: string): Promise<string | null> {
  const name = usnProbeFileName(randomBytes(4).toString('hex'))
  const dir = resolveUsnProbeDir(volumeRoot, tmpdir())
  const probePath = requireAbsolute(path.join(dir, name))
  if (!sameVolumePrefix(volumeRoot, probePath)) {
    logMain('warn', `USN probe path left the volume: ${probePath}`)
    return null
  }
  try {
    await writeFile(probePath, 'MyFileExplorer USN journal probe\n', { flag: 'wx' })
    await unlink(probePath)
    await new Promise((r) => setTimeout(r, 80))
    return name
  } catch (e) {
    logMain(
      'warn',
      `USN probe file failed on ${volumeRoot}: ${e instanceof Error ? e.message : String(e)}`
    )
    try {
      await unlink(probePath)
    } catch {
      /* already gone or never created */
    }
    return null
  }
}

async function finishEnable(
  rawPath: string,
  volumeRoot: string,
  wasActive: boolean
): Promise<UsnQueryResponse> {
  let after = await waitUntilJournalNotDeleting(rawPath)
  if (after.status !== 'active') after = await queryUsnJournalForPath(rawPath)
  if (after.status !== 'active') {
    const { letter } = requireDriveRoot(rawPath)
    if (after.status === 'deleting') {
      throw new AppError(
        'busy',
        `Windows is still deleting the USN journal on ${letter}. Wait until the badge is “Not present”, then Enable again.`
      )
    }
    throw mutateFailError('create', letter, 0)
  }
  if (wasActive) return after
  const probeName = await probeJournalWithTestFile(volumeRoot)
  return { ...after, probeName }
}

export async function enableUsnJournal(
  rawPath: string,
  maxBytes: number,
  deltaBytes: number,
  elevate = false
): Promise<UsnQueryResponse> {
  const { abs, letter } = requireDriveRoot(rawPath)
  const before = await waitUntilJournalNotDeleting(rawPath)
  if (before.status === 'deleting') {
    throw new AppError(
      'busy',
      `Windows is still deleting the USN journal on ${letter}. Wait until the badge is “Not present”, then Enable again.`
    )
  }
  const wasActive = before.status === 'active'
  const sizes = clampUsnJournalSizes(maxBytes, deltaBytes)
  if (elevate) {
    await runFsutilElevated([
      'usn',
      'createjournal',
      `m=${sizes.maxBytes}`,
      `a=${sizes.deltaBytes}`,
      letter
    ])
    return finishEnable(rawPath, abs, wasActive)
  }
  const result = await mutateNative(letter, (h) =>
    createUsnJournal(h, BigInt(sizes.maxBytes), BigInt(sizes.deltaBytes))
  )
  if (result.status === 'ok') return finishEnable(rawPath, abs, wasActive)
  if (result.status === 'denied') {
    throw mutateDeniedError('enable or resize', letter, result.err)
  }
  throw mutateFailError('create', letter, result.err)
}

export async function disableUsnJournal(rawPath: string, elevate = false): Promise<{ disabled: true }> {
  const { letter } = requireDriveRoot(rawPath)
  if (elevate) {
    await runFsutilElevated(['usn', 'deletejournal', '/d', letter])
    return { disabled: true }
  }
  const result = await mutateNative(letter, (h, info) => {
    if (!info) return { ok: true, err: 0 }
    return deleteUsnJournal(h, info.journalId)
  })
  if (result.status === 'ok') return { disabled: true }
  if (result.status === 'denied') {
    throw mutateDeniedError('disable', letter, result.err)
  }
  throw mutateFailError('delete', letter, result.err)
}

export async function clearUsnJournal(
  rawPath: string,
  maxBytes: number,
  deltaBytes: number,
  elevate = false
): Promise<UsnQueryResponse> {
  await disableUsnJournal(rawPath, elevate)
  return enableUsnJournal(rawPath, maxBytes, deltaBytes, elevate)
}

async function resolveJournalInfo(letter: string): Promise<UsnJournalInfo | null> {
  const opened = openVolumeHandle(letter, false)
  if (opened.handle) {
    try {
      const info = queryUsnJournal(opened.handle)
      if (info) return info
    } finally {
      closeHandle(opened.handle)
    }
  }
  const via = await queryUsnJournalViaFsutil(letter)
  if (via && via !== 'absent' && via !== 'deleting') return via
  return null
}

async function recentUsnEntriesElevated(
  letter: string,
  cap: number
): Promise<{ entries: UsnRecentEntry[]; note?: string }> {
  const scratch = path.join(app.getPath('userData'), 'scratch')
  await mkdir(scratch, { recursive: true })
  const outFile = path.join(scratch, `usn-recent-${letter.replace(':', '')}.json`)
  try {
    await unlink(outFile)
  } catch {
    /* first run */
  }
  try {
    await runElevatedUsnRecent(outFile, letter)
  } catch (e) {
    let detail = ''
    try {
      const dumped = JSON.parse(await readFile(outFile, 'utf8')) as { error?: string }
      if (dumped.error) detail = dumped.error
    } catch {
      /* no dump */
    }
    if (detail) {
      throw new AppError('not-allowed', detail, 'Retry as administrator')
    }
    throw e
  }
  let dumped: { entries?: UsnRecentEntry[]; error?: string; err?: number }
  try {
    dumped = JSON.parse(await readFile(outFile, 'utf8')) as {
      entries?: UsnRecentEntry[]
      error?: string
      err?: number
    }
  } finally {
    try {
      await unlink(outFile)
    } catch {
      /* keep scratch if delete fails */
    }
  }
  const entries = Array.isArray(dumped.entries) ? dumped.entries.slice(0, cap) : []
  if (entries.length) return { entries }
  return {
    entries: [],
    note: dumped.error ?? `Administrator read on ${letter} returned no records.`
  }
}

export async function recentUsnEntries(
  rawPath: string,
  limit = 200,
  elevate = false
): Promise<{ entries: UsnRecentEntry[]; note?: string; needsElevation?: boolean }> {
  if (process.platform !== 'win32') return { entries: [] }
  const { letter } = requireDriveRoot(rawPath)
  const cap = Math.min(500, Math.max(1, limit))
  const info = await resolveJournalInfo(letter)
  if (!info) {
    return { entries: [], note: `Could not query the USN journal on ${letter}.` }
  }

  if (elevate) {
    return recentUsnEntriesElevated(letter, cap)
  }

  const writeOpen = openVolumeHandle(letter, true)
  const opened = writeOpen.handle ? writeOpen : openVolumeHandle(letter, false)
  if (!opened.handle) {
    if (needsUsnElevation(opened.err)) {
      return { entries: [], needsElevation: true }
    }
    return { entries: [], note: `Could not open ${letter} to read the journal (Windows error ${opened.err}).` }
  }
  try {
    const { entries, err } = readRecentFromHandle(opened.handle, info, cap)
    if (entries.length) return { entries }
    if (needsUsnElevation(err) || (!writeOpen.handle && needsUsnElevation(writeOpen.err))) {
      return { entries: [], needsElevation: true }
    }
    if (info.nextUsn <= (info.lowestValidUsn > info.firstUsn ? info.lowestValidUsn : info.firstUsn)) {
      return { entries: [], note: 'The journal is empty — no file changes have been recorded yet.' }
    }
    if (err) {
      return {
        entries: [],
        note: `The journal is active but records could not be read (Windows error ${err}).`
      }
    }
    return { entries: [], note: `The journal on ${letter} is active, but no records were readable.` }
  } catch (e) {
    logMain('warn', `USN recent read failed: ${e instanceof Error ? e.message : String(e)}`)
    return { entries: [], note: e instanceof Error ? e.message : String(e) }
  } finally {
    closeHandle(opened.handle)
  }
}
