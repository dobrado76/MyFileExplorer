/**
 * NTFS volume bootstrap (USN enum) + journal poll. Falls back to walk via caller.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { logMain } from '../../logging'
import { broadcast } from '../../ipc/events'
import {
  buildPathMap,
  closeHandle,
  enumUsnData,
  openVolumeHandle,
  queryUsnJournal,
  readUsnJournal,
  volumeLetterFromRoot,
  type UsnEntry
} from './usnNative'
import { deletePathTree, fileRowFromPath, upsertFileRows, type FileUpsert } from '../upsert'

const USN_REASON_FILE_DELETE = 0x00000200
const USN_REASON_RENAME_OLD_NAME = 0x00001000

export type VolumeBootstrapResult = {
  ok: boolean
  processed: number
  journalId: string | null
  nextUsn: number
  mode: 'usn' | 'failed'
}

export async function bootstrapVolumeUsn(
  rootId: number,
  rootPath: string,
  shouldCancel: () => boolean,
  onProgress: (n: number) => void
): Promise<VolumeBootstrapResult> {
  const letter = volumeLetterFromRoot(rootPath)
  if (!letter) return { ok: false, processed: 0, journalId: null, nextUsn: 0, mode: 'failed' }

  const h = openVolumeHandle(letter)
  if (!h) return { ok: false, processed: 0, journalId: null, nextUsn: 0, mode: 'failed' }

  try {
    const journal = queryUsnJournal(h)
    if (!journal) {
      return { ok: false, processed: 0, journalId: null, nextUsn: 0, mode: 'failed' }
    }

    const all: UsnEntry[] = []
    let processed = 0
    for (const batch of enumUsnData(h)) {
      if (shouldCancel()) break
      all.push(...batch)
      processed += batch.length
      if (processed % 5000 < batch.length) onProgress(processed)
      await new Promise((r) => setImmediate(r))
    }

    const pathMap = buildPathMap(rootPath.endsWith('\\') ? rootPath : rootPath + '\\', all)
    const rows: FileUpsert[] = []
    let flushed = 0
    for (const { path: full, isDir } of pathMap.values()) {
      if (shouldCancel()) break
      // Skip the volume root itself
      if (full.replace(/[\\/]+$/, '').toLowerCase() === rootPath.replace(/[\\/]+$/, '').toLowerCase()) {
        continue
      }
      let size = 0
      let mtime = 0
      if (!isDir) {
        try {
          const st = await fsp.stat(full)
          size = st.size
          mtime = st.mtimeMs
        } catch {
          continue
        }
      }
      rows.push(fileRowFromPath(full, isDir, size, mtime))
      if (rows.length >= 500) {
        upsertFileRows(rootId, rows)
        flushed += rows.length
        rows.length = 0
        onProgress(flushed)
        await new Promise((r) => setImmediate(r))
      }
    }
    if (rows.length) {
      upsertFileRows(rootId, rows)
      flushed += rows.length
    }

    logMain('info', `USN bootstrap ${letter}: ${flushed} paths`)
    return {
      ok: flushed > 0,
      processed: flushed,
      journalId: journal.journalId.toString(),
      nextUsn: Number(journal.nextUsn > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : journal.nextUsn),
      mode: 'usn'
    }
  } catch (e) {
    logMain('warn', `USN bootstrap failed ${letter}: ${String(e)}`)
    return { ok: false, processed: 0, journalId: null, nextUsn: 0, mode: 'failed' }
  } finally {
    closeHandle(h)
  }
}

export async function pollVolumeUsn(
  rootId: number,
  rootPath: string,
  journalIdStr: string,
  nextUsnNum: number
): Promise<{ journalId: string; nextUsn: number; changed: number } | null> {
  const letter = volumeLetterFromRoot(rootPath)
  if (!letter) return null
  const h = openVolumeHandle(letter)
  if (!h) return null
  try {
    const journal = queryUsnJournal(h)
    if (!journal) return null
    if (journal.journalId.toString() !== journalIdStr) {
      // Journal wrapped — caller should full reindex
      return null
    }
    const startUsn = BigInt(nextUsnNum)
    const read = readUsnJournal(h, journal.journalId, startUsn)
    if (!read || read.entries.length === 0) {
      return {
        journalId: journalIdStr,
        nextUsn: Number(journal.nextUsn > BigInt(Number.MAX_SAFE_INTEGER) ? nextUsnNum : journal.nextUsn),
        changed: 0
      }
    }

    // Rebuild paths for changed FRNs using a mini enum isn't free — resolve via parent walk of names.
    const frnNames = new Map<bigint, UsnEntry>()
    for (const e of read.entries) frnNames.set(e.frn, e)
    const pathMap = buildPathMap(
      rootPath.endsWith('\\') ? rootPath : rootPath + '\\',
      frnNames.values()
    )

    let changed = 0
    const upserts: FileUpsert[] = []
    for (const e of read.entries) {
      const mapped = pathMap.get(e.frn.toString())
      if (!mapped) continue
      if (e.reason & (USN_REASON_FILE_DELETE | USN_REASON_RENAME_OLD_NAME)) {
        deletePathTree(mapped.path)
        changed++
        continue
      }
      try {
        const st = await fsp.stat(mapped.path)
        upserts.push(
          fileRowFromPath(mapped.path, st.isDirectory(), st.size, st.mtimeMs)
        )
        changed++
      } catch {
        deletePathTree(mapped.path)
        changed++
      }
    }
    if (upserts.length) upsertFileRows(rootId, upserts)

    return {
      journalId: journalIdStr,
      nextUsn: Number(
        read.nextUsn > BigInt(Number.MAX_SAFE_INTEGER) ? nextUsnNum : read.nextUsn
      ),
      changed
    }
  } catch (e) {
    logMain('warn', `USN poll failed ${letter}: ${String(e)}`)
    return null
  } finally {
    closeHandle(h)
  }
}

/** Periodic USN poller for ready volume roots. */
let pollTimer: ReturnType<typeof setInterval> | null = null

export function startUsnPoller(getRoots: () => {
  id: number
  path: string
  usn_journal_id: string | null
  usn_next: number
  status: string
  monitor: string
}[]): void {
  stopUsnPoller()
  pollTimer = setInterval(() => {
    void (async () => {
      for (const r of getRoots()) {
        if (r.monitor !== 'usn' || r.status !== 'ready' || !r.usn_journal_id) continue
        const res = await pollVolumeUsn(r.id, r.path, r.usn_journal_id, r.usn_next)
        if (!res) {
          broadcast({
            type: 'index-progress',
            payload: { rootPath: r.path, processed: 0, done: false, message: 'USN journal changed — reindex recommended' }
          })
          continue
        }
        if (res.changed > 0 || res.nextUsn !== r.usn_next) {
          const { searchDb } = await import('../db')
          searchDb()
            .prepare('UPDATE roots SET usn_next = ?, usn_journal_id = ? WHERE id = ?')
            .run(res.nextUsn, res.journalId, r.id)
        }
      }
    })()
  }, 5000)
}

export function stopUsnPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function isDriveRootPath(p: string): boolean {
  const n = p.replace(/\//g, '\\').replace(/\\+$/, '')
  return /^[a-zA-Z]:$/i.test(n)
}

export function normalizeDriveRoot(p: string): string {
  const m = /^([a-zA-Z]):/i.exec(p)
  if (!m) return p
  return `${m[1]!.toUpperCase()}:\\`
}

export function joinVolumeChild(root: string, name: string): string {
  return path.join(root, name)
}
