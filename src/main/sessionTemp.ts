/**
 * Session-only userData folders (D7): names ending in -scratch, -preview, or
 * -remux. Emptied on start and quit so they cannot accumulate across runs.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const SESSION_TEMP_SUFFIXES = ['-scratch', '-preview', '-remux'] as const

export function isSessionTempDirName(name: string): boolean {
  const lower = name.toLowerCase()
  return SESSION_TEMP_SUFFIXES.some((s) => lower.endsWith(s))
}

async function emptyDir(dir: string): Promise<void> {
  await fsp.rm(dir, { recursive: true, force: true })
  await fsp.mkdir(dir, { recursive: true })
}

function emptyDirSync(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
}

async function listUserDataEntries(userData: string): Promise<string[]> {
  try {
    return await fsp.readdir(userData)
  } catch {
    return []
  }
}

function listUserDataEntriesSync(userData: string): string[] {
  try {
    return fs.readdirSync(userData)
  } catch {
    return []
  }
}

/** Wipe matching directories under `userData` and recreate them empty. */
export async function clearSessionTempDirs(userData: string): Promise<void> {
  for (const name of await listUserDataEntries(userData)) {
    if (!isSessionTempDirName(name)) continue
    const dir = path.join(userData, name)
    try {
      const st = await fsp.stat(dir)
      if (!st.isDirectory()) continue
      await emptyDir(dir)
    } catch {
      /* locked / gone */
    }
  }
}

/** Sync wipe for `before-quit` so the process does not exit mid-delete. */
export function clearSessionTempDirsSync(userData: string): void {
  for (const name of listUserDataEntriesSync(userData)) {
    if (!isSessionTempDirName(name)) continue
    const dir = path.join(userData, name)
    try {
      if (!fs.statSync(dir).isDirectory()) continue
      emptyDirSync(dir)
    } catch {
      /* locked / gone */
    }
  }
}
