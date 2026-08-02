import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { DetailsColumnId, EntryColumnValues } from '@shared/schemas/columns'
import { isAsyncColumn } from '@shared/schemas/columns'
import { requireAbsolute } from '../fs/list'
import { extractColumnValues } from './extract'

let metaDir: string | null = null
const memory = new Map<string, EntryColumnValues>()
const inFlight = new Map<string, Promise<EntryColumnValues>>()
const MAX_MEMORY = 4000

function cacheDir(): string {
  if (!metaDir) metaDir = path.join(app.getPath('userData'), 'column-meta')
  return metaDir
}

function cacheKey(file: string, mtimeMs: number, size: number, columns: DetailsColumnId[]): string {
  const cols = [...columns].filter(isAsyncColumn).sort().join(',')
  return crypto
    .createHash('sha1')
    .update(`v1|${file.toLowerCase()}|${mtimeMs}|${size}|${cols}`)
    .digest('hex')
}

async function readDisk(key: string): Promise<EntryColumnValues | null> {
  try {
    const raw = await fsp.readFile(path.join(cacheDir(), `${key}.json`), 'utf8')
    const parsed = JSON.parse(raw) as EntryColumnValues
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function writeDisk(key: string, values: EntryColumnValues): Promise<void> {
  try {
    await fsp.mkdir(cacheDir(), { recursive: true })
    const file = path.join(cacheDir(), `${key}.json`)
    const tmp = file + '.tmp'
    await fsp.writeFile(tmp, JSON.stringify(values))
    await fsp.rename(tmp, file)
  } catch {
    // cache is best-effort
  }
}

async function loadOne(rawPath: string, columns: DetailsColumnId[]): Promise<EntryColumnValues> {
  const file = requireAbsolute(rawPath)
  const asyncCols = columns.filter(isAsyncColumn)
  if (asyncCols.length === 0) return {}

  let st
  try {
    st = await fsp.stat(file)
  } catch {
    return {}
  }
  if (!st.isFile()) return {}

  const key = cacheKey(file, st.mtimeMs, st.size, asyncCols)
  const mem = memory.get(key)
  if (mem) return mem

  const disk = await readDisk(key)
  if (disk) {
    if (memory.size > MAX_MEMORY) memory.clear()
    memory.set(key, disk)
    return disk
  }

  const pending = inFlight.get(key)
  if (pending) return pending

  const job = (async (): Promise<EntryColumnValues> => {
    try {
      const values = await extractColumnValues(file, asyncCols)
      if (memory.size > MAX_MEMORY) memory.clear()
      memory.set(key, values)
      void writeDisk(key, values)
      return values
    } finally {
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, job)
  return job
}

/** Bounded concurrency for a folder of rows. */
export async function getColumnMetaMany(
  paths: string[],
  columns: DetailsColumnId[]
): Promise<Record<string, EntryColumnValues>> {
  const asyncCols = columns.filter(isAsyncColumn)
  const out: Record<string, EntryColumnValues> = {}
  if (asyncCols.length === 0 || paths.length === 0) return out

  const concurrency = 4
  let i = 0
  async function worker(): Promise<void> {
    while (i < paths.length) {
      const idx = i++
      const p = paths[idx]!
      try {
        out[p] = await loadOne(p, asyncCols)
      } catch {
        out[p] = {}
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => worker()))
  return out
}

export async function clearColumnMetaCache(): Promise<void> {
  memory.clear()
  inFlight.clear()
  await fsp.rm(cacheDir(), { recursive: true, force: true })
  await fsp.mkdir(cacheDir(), { recursive: true })
}
