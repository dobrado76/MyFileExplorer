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
import { beginOp, type OpReporter } from './opProgress'

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

/** Count files (and empty directories) under paths — used as progress work units. */
async function countWorkUnits(roots: string[]): Promise<number> {
  let n = 0
  const walk = async (p: string): Promise<void> => {
    let st: fs.Stats
    try {
      st = await fsp.lstat(p)
    } catch {
      return
    }
    if (st.isDirectory()) {
      let ents: string[]
      try {
        ents = await fsp.readdir(p)
      } catch {
        n++
        return
      }
      if (ents.length === 0) {
        n++
        return
      }
      for (const name of ents) {
        await walk(path.join(p, name))
      }
    } else {
      n++
    }
  }
  for (const root of roots) await walk(root)
  return Math.max(n, 1)
}

async function copyTree(
  source: string,
  target: string,
  progress: OpReporter | null
): Promise<void> {
  let st: fs.Stats
  try {
    st = await fsp.lstat(source)
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'copy', path: source, isDir: false })
  }

  if (st.isDirectory()) {
    await fsp.mkdir(target, { recursive: true })
    let ents: string[]
    try {
      ents = await fsp.readdir(source)
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'copy', path: source, isDir: true })
    }
    if (ents.length === 0) {
      progress?.tick(path.basename(source))
      return
    }
    for (const name of ents) {
      await copyTree(path.join(source, name), path.join(target, name), progress)
    }
    return
  }

  // Symlinks / files: copy bytes (follow for non-symlink via copyFile).
  try {
    if (st.isSymbolicLink()) {
      const link = await fsp.readlink(source)
      try {
        await fsp.symlink(link, target)
      } catch {
        await fsp.copyFile(source, target)
      }
    } else {
      await fsp.copyFile(source, target)
    }
    progress?.tick(path.basename(source))
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'copy', path: source, isDir: false })
  }
}

async function deleteTree(target: string, progress: OpReporter | null): Promise<void> {
  let st: fs.Stats
  try {
    st = await fsp.lstat(target)
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'delete', path: target, isDir: false })
  }

  if (st.isDirectory()) {
    let ents: string[]
    try {
      ents = await fsp.readdir(target)
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'delete', path: target, isDir: true })
    }
    for (const name of ents) {
      await deleteTree(path.join(target, name), progress)
    }
    try {
      await fsp.rmdir(target)
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'delete', path: target, isDir: true })
    }
    if (ents.length === 0) progress?.tick(path.basename(target))
    return
  }

  try {
    await fsp.unlink(target)
    progress?.tick(path.basename(target))
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'delete', path: target, isDir: false })
  }
}

export async function copyEntries(
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy
): Promise<CopyResponse> {
  const plan = await planTransfer(sources, destinationDir, policy)
  const copied: string[] = []
  const skipped: string[] = []
  const workSources: string[] = []
  for (const item of plan) {
    if ('skip' in item) skipped.push(item.skip)
    else workSources.push(item.source)
  }

  const total = workSources.length > 0 ? await countWorkUnits(workSources) : 0
  const progress = beginOp('copy', total, 'Copying…')
  try {
    for (const item of plan) {
      if ('skip' in item) continue
      let isDir = false
      try {
        isDir = (await fsp.stat(item.source)).isDirectory()
      } catch {
        /* ignore */
      }
      try {
        // Replace: remove existing target first when present.
        if (policy === 'replace' && (await pathExists(item.target))) {
          await fsp.rm(item.target, { recursive: true, force: true })
        }
        await copyTree(item.source, item.target, progress)
        copied.push(item.target)
      } catch (e) {
        if (e instanceof AppError) throw e
        throw await appErrorFromFsFailure(e, { action: 'copy', path: item.source, isDir })
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    throw e
  }
  return { copied, skipped }
}

async function relocateOne(
  source: string,
  target: string,
  progress: OpReporter | null,
  units: number
): Promise<void> {
  if (source === target) {
    progress?.advance(units, path.basename(source))
    return
  }
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
    // Same-volume rename is atomic — jump progress by this root's work units.
    progress?.advance(units, path.basename(target))
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    if (code === 'EXDEV') {
      await copyTree(source, target, progress)
      await deleteTree(source, null)
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
  const unitsBySource = new Map<string, number>()
  let total = 0
  for (const pair of pairs) {
    const source = requireAbsolute(pair.from)
    const u = await countWorkUnits([source])
    unitsBySource.set(source.toLowerCase(), u)
    total += u
  }
  const progress = beginOp('relocate', total, 'Moving…')
  try {
    for (const pair of pairs) {
      const source = requireAbsolute(pair.from)
      const target = requireAbsolute(pair.to)
      if (!(await pathExists(source))) {
        throw new AppError('not-found', `Not found: ${source}`)
      }
      assertTransferLegal(source, path.dirname(target))
      const units = unitsBySource.get(source.toLowerCase()) ?? 1
      await relocateOne(source, target, progress, units)
      moved.push(target)
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    throw e
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
  const workSources: string[] = []
  for (const item of plan) {
    if ('skip' in item) skipped.push(item.skip)
    else workSources.push(item.source)
  }

  const unitsBySource = new Map<string, number>()
  let total = 0
  for (const s of workSources) {
    const u = await countWorkUnits([s])
    unitsBySource.set(s.toLowerCase(), u)
    total += u
  }
  const progress = beginOp('move', total, 'Moving…')
  try {
    for (const item of plan) {
      if ('skip' in item) continue
      if (policy === 'replace' && (await pathExists(item.target))) {
        await fsp.rm(item.target, { recursive: true, force: true })
      }
      const units = unitsBySource.get(item.source.toLowerCase()) ?? 1
      await relocateOne(item.source, item.target, progress, units)
      moved.push(item.target)
      moves.push({ from: item.source, to: item.target })
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    throw e
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

  const progress = beginOp('trash', absolute.length, 'Moving to Recycle Bin…')
  try {
    // Windows: SHFileOperation + FOF_ALLOWUNDO → real Recycle Bin (D7 / product spec).
    // Process one-at-a-time so the status bar can show determinate progress.
    if (process.platform === 'win32') {
      for (const p of absolute) {
        recyclePathsWin32([p])
        progress.tick(path.basename(p))
      }
    } else {
      for (const p of absolute) {
        await shell.trashItem(p)
        progress.tick(path.basename(p))
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
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
  const absolute: string[] = []
  for (const raw of paths) {
    absolute.push(requireAbsolute(raw))
  }
  const total = absolute.length > 0 ? await countWorkUnits(absolute) : 0
  const progress = beginOp('delete', total, 'Deleting…')
  const deleted: string[] = []
  try {
    for (const p of absolute) {
      let isDir = false
      try {
        isDir = (await fsp.stat(p)).isDirectory()
      } catch {
        /* ignore */
      }
      releaseWatchersForTree(p)
      muteWatchers(600)
      try {
        await deleteTree(p, progress)
        deleted.push(p)
      } catch (e) {
        if (e instanceof AppError) throw e
        throw await appErrorFromFsFailure(e, { action: 'delete', path: p, isDir })
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    throw e
  }
  return { deleted }
}
