import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'
import { AppError } from '@shared/result'
import type {
  ConflictItem,
  ConflictPolicy,
  ConflictSide,
  CopyResponse,
  EntryKind,
  MoveResponse
} from '@shared/schemas/fs'
import { isSameOrUnder, isStrictlyInside } from '../security/paths'
import { requireAbsolute, pathExists } from './list'
import { recyclePathsWin32 } from './trashWin32'
import { muteWatchers, releaseWatchersForTree } from './watch'
import { appErrorFromFsFailure } from './fsErrors'

const IMAGE_DIM_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'avif',
  'heic',
  'heif'
])

export async function makeDirectory(parent: string, name: string): Promise<{ path: string }> {
  const dir = requireAbsolute(parent)
  const target = path.join(dir, name)
  await fsp.mkdir(target)
  return { path: target }
}

export async function createFile(parent: string, name: string): Promise<{ path: string }> {
  const dir = requireAbsolute(parent)
  const target = path.join(dir, name)
  const handle = await fsp.open(target, 'wx')
  await handle.close()
  return { path: target }
}

export async function renameEntry(p: string, newName: string): Promise<{ path: string }> {
  const source = requireAbsolute(p)
  const target = path.join(path.dirname(source), newName)
  if (target === source) return { path: source }
  // Allow case-only renames on Windows (target "exists" as the same file).
  const caseOnly = process.platform === 'win32' && target.toLowerCase() === source.toLowerCase()
  if (!caseOnly && (await pathExists(target))) {
    throw new AppError('conflict', `"${newName}" already exists`, 'Choose a different name.')
  }

  let isDir = false
  try {
    isDir = (await fsp.stat(source)).isDirectory()
  } catch {
    /* rename will surface not-found */
  }

  // Drop our own directory watches on this tree — they hold the folder open.
  releaseWatchersForTree(source)
  muteWatchers(600)

  try {
    await fsp.rename(source, target)
    return { path: target }
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'rename', path: source, isDir })
  }
}

/** Generate "name (2).ext", "name (3).ext", … that does not exist in dir. */
export async function uniqueTargetName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!(await pathExists(path.join(dir, candidate)))) return candidate
  }
  throw new AppError('io', 'Could not find a unique name')
}

async function readConflictSide(filePath: string): Promise<ConflictSide> {
  const p = requireAbsolute(filePath)
  const ext = path.extname(p).replace(/^\./, '').toLowerCase()
  let kind: EntryKind | null = null
  let size = 0
  let mtimeMs = 0
  let birthtimeMs = 0
  try {
    const st = await fsp.stat(p)
    kind = st.isDirectory() ? 'dir' : st.isSymbolicLink() ? 'symlink' : 'file'
    size = st.isDirectory() ? 0 : st.size
    mtimeMs = st.mtimeMs
    birthtimeMs = st.birthtimeMs
  } catch {
    // leave zeros / null
  }

  let width: number | null = null
  let height: number | null = null
  if (kind === 'file' && IMAGE_DIM_EXTS.has(ext)) {
    try {
      const { default: sharp } = await import('sharp')
      const meta = await sharp(p, {
        failOn: 'none',
        limitInputPixels: 512 * 1024 * 1024
      }).metadata()
      width = meta.width ?? null
      height = meta.height ?? null
    } catch {
      // ignore probe failures
    }
  }

  return { path: p, kind, size, mtimeMs, birthtimeMs, ext, width, height }
}

export async function checkConflicts(
  sources: string[],
  destinationDir: string
): Promise<{ conflicts: string[]; items: ConflictItem[] }> {
  const dest = requireAbsolute(destinationDir)
  const conflicts: string[] = []
  const items: ConflictItem[] = []
  for (const s of sources) {
    const sourcePath = requireAbsolute(s)
    const name = path.basename(sourcePath)
    const destPath = path.join(dest, name)
    if (!(await pathExists(destPath))) continue
    conflicts.push(name)
    const [source, destination] = await Promise.all([
      readConflictSide(sourcePath),
      readConflictSide(destPath)
    ])
    items.push({ name, source, destination })
  }
  return { conflicts, items }
}

function assertTransferLegal(source: string, dest: string): void {
  if (isSameOrUnder(dest, source)) {
    throw new AppError('validation', 'Cannot copy or move a folder into itself')
  }
}

type TransferPlanItem = { source: string; target: string } | { skip: string }

async function planTransfer(
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy
): Promise<TransferPlanItem[]> {
  const dest = requireAbsolute(destinationDir)
  const items: TransferPlanItem[] = []
  for (const raw of sources) {
    const source = requireAbsolute(raw)
    assertTransferLegal(source, dest)
    const name = path.basename(source)
    let target = path.join(dest, name)
    if (target === source && policy === 'rename') {
      // "copy here" duplicates as "name (2)"
      target = path.join(dest, await uniqueTargetName(dest, name))
      items.push({ source, target })
      continue
    }
    if (isStrictlyInside(target, source) || target === source) {
      items.push({ skip: source })
      continue
    }
    if (await pathExists(target)) {
      if (policy === 'fail') {
        throw new AppError('conflict', `"${name}" already exists in destination`)
      }
      if (policy === 'skip') {
        items.push({ skip: source })
        continue
      }
      if (policy === 'rename') {
        target = path.join(dest, await uniqueTargetName(dest, name))
      }
      // 'replace' keeps target as-is; fs.cp force overwrites, move removes first
    }
    items.push({ source, target })
  }
  return items
}

export async function copyEntries(
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy
): Promise<CopyResponse> {
  const plan = await planTransfer(sources, destinationDir, policy)
  const copied: string[] = []
  const skipped: string[] = []
  for (const item of plan) {
    if ('skip' in item) {
      skipped.push(item.skip)
      continue
    }
    let isDir = false
    try {
      isDir = (await fsp.stat(item.source)).isDirectory()
    } catch {
      /* ignore */
    }
    try {
      await fsp.cp(item.source, item.target, { recursive: true, force: true })
      copied.push(item.target)
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'copy', path: item.source, isDir })
    }
  }
  return { copied, skipped }
}

async function relocateOne(source: string, target: string): Promise<void> {
  if (source === target) return
  const caseOnly =
    process.platform === 'win32' && source.toLowerCase() === target.toLowerCase()
  if (!caseOnly && (await pathExists(target))) {
    throw new AppError('conflict', `"${path.basename(target)}" already exists`)
  }
  await fsp.mkdir(path.dirname(target), { recursive: true })
  let isDir = false
  try {
    isDir = (await fsp.stat(source)).isDirectory()
  } catch {
    /* ignore */
  }
  releaseWatchersForTree(source)
  muteWatchers(600)
  try {
    await fsp.rename(source, target)
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'EXDEV') {
      await fsp.cp(source, target, { recursive: true, force: true })
      await fsp.rm(source, { recursive: true, force: true })
    } else {
      throw await appErrorFromFsFailure(e, { action: 'move', path: source, isDir })
    }
  }
}

/** Move each path to an exact destination (used for undo/redo of moves & renames). */
export async function relocateEntries(
  pairs: { from: string; to: string }[]
): Promise<{ moved: string[] }> {
  const moved: string[] = []
  for (const pair of pairs) {
    const source = requireAbsolute(pair.from)
    const target = requireAbsolute(pair.to)
    if (!(await pathExists(source))) {
      throw new AppError('not-found', `Not found: ${source}`)
    }
    assertTransferLegal(source, path.dirname(target))
    await relocateOne(source, target)
    moved.push(target)
  }
  return { moved }
}

export async function moveEntries(
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy
): Promise<MoveResponse> {
  const plan = await planTransfer(sources, destinationDir, policy)
  const moved: string[] = []
  const moves: { from: string; to: string }[] = []
  const skipped: string[] = []
  for (const item of plan) {
    if ('skip' in item) {
      skipped.push(item.skip)
      continue
    }
    if (policy === 'replace' && (await pathExists(item.target))) {
      await fsp.rm(item.target, { recursive: true, force: true })
    }
    await relocateOne(item.source, item.target)
    moved.push(item.target)
    moves.push({ from: item.source, to: item.target })
  }
  return { moved, moves, skipped }
}

export async function trashEntries(paths: string[]): Promise<{ trashed: string[] }> {
  const absolute: string[] = []
  for (const raw of paths) {
    const p = requireAbsolute(raw)
    if (!(await pathExists(p))) throw new AppError('not-found', `Not found: ${p}`)
    absolute.push(p)
    releaseWatchersForTree(p)
  }
  muteWatchers(600)

  // Windows: SHFileOperation + FOF_ALLOWUNDO → real Recycle Bin (D7 / product spec).
  // Electron shell.trashItem is kept only as a non-Windows fallback.
  try {
    if (process.platform === 'win32') {
      recyclePathsWin32(absolute)
    } else {
      for (const p of absolute) {
        await shell.trashItem(p)
      }
    }
  } catch (e) {
    if (e instanceof AppError && (e.code === 'cancelled' || e.code === 'validation')) throw e
    const stuck = absolute.find((p) => fs.existsSync(p)) ?? absolute[0]!
    let isDir = false
    try {
      isDir = (await fsp.stat(stuck)).isDirectory()
    } catch {
      /* ignore */
    }
    throw await appErrorFromFsFailure(e, { action: 'delete', path: stuck, isDir })
  }
  return { trashed: absolute }
}

export async function deletePermanently(paths: string[]): Promise<{ deleted: string[] }> {
  const deleted: string[] = []
  for (const raw of paths) {
    const p = requireAbsolute(raw)
    let isDir = false
    try {
      isDir = (await fsp.stat(p)).isDirectory()
    } catch {
      /* ignore */
    }
    releaseWatchersForTree(p)
    muteWatchers(600)
    try {
      await fsp.rm(p, { recursive: true, force: false })
      deleted.push(p)
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'delete', path: p, isDir })
    }
  }
  return { deleted }
}
