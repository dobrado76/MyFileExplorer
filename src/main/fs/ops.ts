import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { shell } from 'electron'
import { AppError } from '@shared/result'
import type {
  ConflictItem,
  ConflictPolicy,
  ConflictSide,
  CopyResponse,
  DeletePermanentResponse,
  EntryKind,
  MoveResponse,
  OpIssue,
  ResolveIssuesRequest,
  ResolveIssuesResponse,
  TrashResponse
} from '@shared/schemas/fs'
import { classifyOpIssue, resolveIssueDecision, shouldQueueNameConflict } from '@shared/opIssues'
import {
  formatRemoteLocation,
  parseRemoteLocation,
  remoteBasename,
  remoteJoin,
  remoteParentPath
} from '@shared/remotePaths'
import { isVolumeRootPath } from '@shared/paths'
import { isSameOrUnder, isStrictlyInside } from '../security/paths'
import { requireAbsolute, pathExists } from './list'
import { recyclePathWin32Robust } from './trashWin32'
import {
  emitFsChanged,
  muteWatchers,
  releaseWatchersAffecting,
  suspendWatching,
  resumeWatching
} from './watch'
import { appErrorFromFsFailure } from './fsErrors'
import { beginOp, type OpReporter } from './opProgress'

const IMAGE_DIM_EXTS = new Set([
  'jpg',
  'jpeg',
  'jfif',
  'png',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'tga',
  'avif',
  'heic',
  'heif'
])

export async function makeDirectory(parent: string, name: string): Promise<{ path: string }> {
  const dir = requireAbsolute(parent)
  if (dir.toLowerCase().startsWith('mfe-remote://')) {
    const { remoteMkdir } = await import('../remote/sessionPool')
    return { path: await remoteMkdir(dir, name) }
  }
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

function joinName(dir: string, name: string): string {
  if (dir.toLowerCase().startsWith('mfe-remote://')) {
    const loc = parseRemoteLocation(dir)
    const joined = loc ? remoteJoin(loc.remotePath, name) : null
    if (!loc || !joined) throw new AppError('validation', 'Invalid name')
    return formatRemoteLocation(loc.connectionId, joined)
  }
  return path.join(dir, name)
}

function entryBasename(p: string): string {
  if (p.toLowerCase().startsWith('mfe-remote://')) {
    const loc = parseRemoteLocation(p)
    return loc ? remoteBasename(loc.remotePath) : path.basename(p)
  }
  return path.basename(p)
}

export async function renameEntry(
  p: string,
  newName: string,
  policy: ConflictPolicy = 'fail'
): Promise<{ path: string }> {
  const source = requireAbsolute(p)
  if (source.toLowerCase().startsWith('mfe-remote://')) {
    return renameRemoteEntry(source, newName, policy)
  }
  const parent = path.dirname(source)
  let target = path.join(parent, newName)
  if (target === source) return { path: source }
  // Allow case-only renames on Windows (target "exists" as the same file).
  const caseOnly = process.platform === 'win32' && target.toLowerCase() === source.toLowerCase()
  if (!caseOnly && (await pathExists(target))) {
    if (policy === 'skip') return { path: source }
    if (policy === 'rename') {
      target = path.join(parent, await uniqueTargetName(parent, newName))
    } else if (policy === 'replace') {
      let srcDir = false
      let dstDir = false
      try {
        srcDir = (await fsp.stat(source)).isDirectory()
        dstDir = (await fsp.stat(target)).isDirectory()
      } catch {
        /* rename / merge will surface not-found */
      }
      if (srcDir && dstDir) {
        releaseWatchersAffecting([source, target])
        muteWatchers(400)
        const progress = beginOp('relocate', 1, 'Merging…')
        progress.pulse(source)
        const heartbeat = setInterval(() => progress.pulse(source), 500)
        try {
          await mergeDirectoryInto(source, target)
          progress.tick(target)
          progress.finish()
          return { path: target }
        } catch (e) {
          progress.fail()
          throw await appErrorFromFsFailure(e, { action: 'rename', path: source, isDir: true })
        } finally {
          clearInterval(heartbeat)
        }
      }
      await fsp.rm(target, { recursive: true, force: true })
    } else {
      throw new AppError('conflict', `"${newName}" already exists`, 'Choose a different name.')
    }
  }

  let isDir = false
  try {
    isDir = (await fsp.stat(source)).isDirectory()
  } catch {
    /* rename will surface not-found */
  }

  // Drop our own directory watches on this tree — they hold the folder open.
  releaseWatchersAffecting([source])
  muteWatchers(400)

  const progress = beginOp('relocate', 1, 'Renaming…')
  progress.pulse(source)
  const heartbeat = setInterval(() => progress.pulse(source), 500)
  try {
    await fsp.rename(source, target)
    progress.tick(target)
    progress.finish()
    return { path: target }
  } catch (e) {
    progress.fail()
    throw await appErrorFromFsFailure(e, { action: 'rename', path: source, isDir })
  } finally {
    clearInterval(heartbeat)
  }
}

async function renameRemoteEntry(
  source: string,
  newName: string,
  policy: ConflictPolicy
): Promise<{ path: string }> {
  const loc = parseRemoteLocation(source)
  if (!loc) throw new AppError('validation', 'Not a remote location')
  const parentRemote = remoteParentPath(loc.remotePath) ?? '/'
  const destRemote = remoteJoin(parentRemote, newName)
  if (!destRemote) throw new AppError('validation', 'Invalid name')
  let finalName = newName
  const target = formatRemoteLocation(loc.connectionId, destRemote)
  if (target.toLowerCase() === source.toLowerCase()) return { path: source }
  if (await pathExists(target)) {
    if (policy === 'skip') return { path: source }
    if (policy === 'rename') {
      const parentUri = formatRemoteLocation(loc.connectionId, parentRemote)
      finalName = await uniqueTargetName(parentUri, newName)
    } else if (policy === 'replace') {
      const { remoteDelete } = await import('../remote/sessionPool')
      await remoteDelete(target)
    } else {
      throw new AppError('conflict', `"${newName}" already exists`, 'Choose a different name.')
    }
  }
  const { remoteRename } = await import('../remote/sessionPool')
  return { path: await remoteRename(source, finalName) }
}

/** Explorer-style folder merge: move children into dest, then remove the empty source. */
export async function mergeDirectoryInto(source: string, target: string): Promise<void> {
  const src = requireAbsolute(source)
  const dest = requireAbsolute(target)
  if (src.toLowerCase() === dest.toLowerCase()) return
  if (isSameOrUnder(dest, src)) {
    throw new AppError('validation', 'Cannot merge a folder into itself')
  }
  let names: string[]
  try {
    names = await fsp.readdir(src)
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'rename', path: src, isDir: true })
  }
  for (const name of names) {
    const from = path.join(src, name)
    const to = path.join(dest, name)
    let fromDir: boolean
    try {
      fromDir = (await fsp.lstat(from)).isDirectory()
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'rename', path: from, isDir: false })
    }
    let toExists = false
    let toDir = false
    try {
      const st = await fsp.lstat(to)
      toExists = true
      toDir = st.isDirectory()
    } catch {
      /* dest child missing — rename into place */
    }
    if (toExists && fromDir && toDir) {
      await mergeDirectoryInto(from, to)
      continue
    }
    if (toExists) {
      await fsp.rm(to, { recursive: true, force: true })
    }
    try {
      await fsp.rename(from, to)
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'rename', path: from, isDir: fromDir })
    }
  }
  try {
    await fsp.rmdir(src)
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'rename', path: src, isDir: true })
  }
}

/** Generate "name (2).ext", "name (3).ext", … that does not exist in dir. */
export async function uniqueTargetName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!(await pathExists(joinName(dir, candidate)))) return candidate
  }
  throw new AppError('io', 'Could not find a unique name')
}

async function readConflictSide(filePath: string): Promise<ConflictSide> {
  const p = requireAbsolute(filePath)
  if (p.toLowerCase().startsWith('mfe-remote://')) {
    const { remoteStat } = await import('../remote/sessionPool')
    const { remoteBasename, parseRemoteLocation } = await import('@shared/remotePaths')
    const st = await remoteStat(p)
    const name = remoteBasename(parseRemoteLocation(p)?.remotePath ?? '') || p
    const ext = path.extname(name).replace(/^\./, '').toLowerCase()
    return {
      path: p,
      kind: st?.kind === 'dir' ? 'dir' : st?.kind === 'file' ? 'file' : null,
      size: st?.size ?? 0,
      mtimeMs: st?.mtimeMs ?? 0,
      birthtimeMs: 0,
      ext,
      width: null,
      height: null
    }
  }
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
  if (kind === 'file' && ext === 'hdr') {
    try {
      const handle = await fsp.open(p, 'r')
      let buf: Buffer
      try {
        buf = Buffer.alloc(16 * 1024)
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
        buf = buf.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
      const { parseHdrHeader } = await import('../preview/hdr')
      const header = parseHdrHeader(buf)
      width = header?.width ?? null
      height = header?.height ?? null
    } catch {
      // ignore probe failures
    }
  } else if (kind === 'file' && IMAGE_DIM_EXTS.has(ext)) {
    try {
      const { default: sharp } = await import('sharp')
      const bytes = await fsp.readFile(p)
      const meta = await sharp(bytes, {
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
  destinationDir: string,
  targets?: string[]
): Promise<{ conflicts: string[]; items: ConflictItem[] }> {
  const dest = requireAbsolute(destinationDir)
  const involvesRemote =
    dest.toLowerCase().startsWith('mfe-remote://') ||
    sources.some((s) => s.toLowerCase().startsWith('mfe-remote://'))

  const remotePaths = involvesRemote ? await import('@shared/remotePaths') : null
  const remotePool = involvesRemote ? await import('../remote/sessionPool') : null

  const conflicts: string[] = []
  const items: ConflictItem[] = []
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i]!
    const sourcePath = requireAbsolute(s)
    const srcRemote = sourcePath.toLowerCase().startsWith('mfe-remote://')
    const name = srcRemote
      ? remotePaths!.remoteBasename(
          remotePaths!.parseRemoteLocation(sourcePath)?.remotePath ?? ''
        ) || 'file'
      : path.basename(sourcePath)

    let destPath: string
    if (targets?.[i]) {
      destPath = requireAbsolute(targets[i]!)
    } else if (dest.toLowerCase().startsWith('mfe-remote://')) {
      const loc = remotePaths!.parseRemoteLocation(dest)
      const joined = remotePaths!.remoteJoin(loc?.remotePath ?? '/', name)
      if (!loc || !joined) continue
      destPath = remotePaths!.formatRemoteLocation(loc.connectionId, joined)
    } else {
      destPath = path.join(dest, name)
    }

    const exists = dest.toLowerCase().startsWith('mfe-remote://')
      ? (await remotePool!.remoteStatKind(destPath)) != null
      : await pathExists(destPath)
    if (!exists) continue
    conflicts.push(targets?.[i] ? entryBasename(destPath) : name)
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

type TransferPlanItem =
  | { source: string; target: string }
  | { skip: string }
  | { conflict: true; source: string; target: string }

function nodeErrno(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code
  }
  return null
}

async function mtimeMsOf(p: string): Promise<number | undefined> {
  try {
    return (await fsp.stat(p)).mtimeMs
  } catch {
    return undefined
  }
}

async function toIssue(
  e: unknown,
  action: 'copy' | 'move' | 'delete',
  source: string,
  dest?: string,
  isDir?: boolean
): Promise<OpIssue> {
  const mapped =
    e instanceof AppError ? e : await appErrorFromFsFailure(e, { action, path: source, isDir })
  const kind = classifyOpIssue(mapped.code, nodeErrno(e))
  let sourceMtimeMs: number | undefined
  let destMtimeMs: number | undefined
  if (kind === 'name_conflict') {
    sourceMtimeMs = await mtimeMsOf(source)
    if (dest) destMtimeMs = await mtimeMsOf(dest)
  }
  return {
    kind,
    code: mapped.code,
    source,
    dest,
    message: mapped.message,
    sourceMtimeMs,
    destMtimeMs
  }
}

function isCancelled(e: unknown): boolean {
  return e instanceof AppError && e.code === 'cancelled'
}

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
      if (shouldQueueNameConflict(policy, true)) {
        items.push({ conflict: true, source, target })
        continue
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
async function countWorkUnits(roots: string[], progress?: OpReporter | null): Promise<number> {
  let n = 0
  const stack = [...roots]
  const seen = new Set<string>()
  while (stack.length > 0) {
    progress?.throwIfCancelled()
    const p = stack.pop()!
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    let st: fs.Stats
    try {
      st = await fsp.lstat(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      let ents: fs.Dirent[]
      try {
        ents = await fsp.readdir(p, { withFileTypes: true })
      } catch {
        n++
        continue
      }
      if (ents.length === 0) {
        n++
        continue
      }
      for (const e of ents) {
        if (e.isDirectory()) stack.push(path.join(p, e.name))
        else n++
      }
    } else {
      n++
    }
    if (progress && n > 0 && n % 250 === 0) progress.setDone(n, p)
  }
  progress?.setDone(n, roots[0])
  return Math.max(n, 1)
}

/** Stream copies for files at/above this size so the status bar can show bytes. */
const LARGE_FILE_COPY_BYTES = 8 * 1024 * 1024

async function copyFileWithProgress(
  source: string,
  target: string,
  size: number,
  progress: OpReporter | null,
  displayName: string
): Promise<void> {
  progress?.throwIfCancelled()

  // Versioned NTFS image → non-ADS volume: write tip as the file body
  // (keep latest edit; pristine original + VER_* history cannot travel).
  try {
    const { tipBytesForNonAdsDest } = await import('./imageEdit')
    const tip = await tipBytesForNonAdsDest(source, target)
    if (tip) {
      if (!progress || tip.length < LARGE_FILE_COPY_BYTES) {
        await fsp.writeFile(target, tip)
        progress?.tick(displayName)
        return
      }
      progress.reportBytes(0, tip.length, displayName)
      await fsp.writeFile(target, tip)
      progress.reportBytes(tip.length, tip.length, displayName)
      progress.tick(displayName)
      return
    }
  } catch {
    /* fall through to normal copy */
  }

  if (!progress || size < LARGE_FILE_COPY_BYTES) {
    await fsp.copyFile(source, target)
    progress?.tick(displayName)
    return
  }

  progress.reportBytes(0, size, displayName)
  let copied = 0
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      try {
        progress.throwIfCancelled()
      } catch (e) {
        cb(e instanceof Error ? e : new Error(String(e)))
        return
      }
      copied += (chunk as Buffer).length
      progress.reportBytes(copied, size, displayName)
      cb(null, chunk)
    }
  })
  try {
    await pipeline(fs.createReadStream(source), counter, fs.createWriteStream(target))
  } catch (e) {
    await fsp.rm(target, { force: true }).catch(() => undefined)
    if (e instanceof AppError && e.code === 'cancelled') throw e
    throw e
  }
  progress.tick(displayName)
}

async function copyTree(
  source: string,
  target: string,
  progress: OpReporter | null,
  opts?: { notifyParentOnCreate?: boolean; discover?: boolean }
): Promise<void> {
  progress?.throwIfCancelled()
  const discover = opts?.discover !== false
  let st: fs.Stats
  try {
    st = await fsp.lstat(source)
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'copy', path: source, isDir: false })
  }

  if (st.isDirectory()) {
    await fsp.mkdir(target, { recursive: true })
    if (opts?.notifyParentOnCreate) {
      emitFsChanged(path.dirname(target), { bypassMute: true })
    }
    let ents: fs.Dirent[]
    try {
      ents = await fsp.readdir(source, { withFileTypes: true })
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'copy', path: source, isDir: true })
    }
    if (ents.length === 0) {
      if (discover) progress?.addToTotal(1, source)
      progress?.tick(source)
      return
    }
    const files: string[] = []
    const dirs: string[] = []
    for (const e of ents) {
      if (e.isDirectory()) dirs.push(e.name)
      else files.push(e.name)
    }
    if (discover && files.length > 0) progress?.addToTotal(files.length, source)
    for (const name of files) {
      progress?.throwIfCancelled()
      await copyTree(path.join(source, name), path.join(target, name), progress, {
        discover: false
      })
    }
    for (const name of dirs) {
      progress?.throwIfCancelled()
      await copyTree(path.join(source, name), path.join(target, name), progress, {
        discover
      })
    }
    return
  }

  try {
    if (st.isSymbolicLink()) {
      const link = await fsp.readlink(source)
      try {
        await fsp.symlink(link, target)
      } catch {
        await copyFileWithProgress(source, target, st.size, progress, source)
        return
      }
      progress?.tick(source)
    } else {
      await copyFileWithProgress(source, target, st.size, progress, source)
    }
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'copy', path: source, isDir: false })
  }
}

async function deleteTree(target: string, progress: OpReporter | null): Promise<void> {
  progress?.throwIfCancelled()
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
      progress?.throwIfCancelled()
      await deleteTree(path.join(target, name), progress)
    }
    try {
      await fsp.rmdir(target)
    } catch (e) {
      throw await appErrorFromFsFailure(e, { action: 'delete', path: target, isDir: true })
    }
    if (ents.length === 0) progress?.tick(target)
    return
  }

  try {
    progress?.pulse(target)
    await fsp.unlink(target)
    progress?.tick(target)
  } catch (e) {
    throw await appErrorFromFsFailure(e, { action: 'delete', path: target, isDir: false })
  }
}

async function copyWithRemotes(
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy
): Promise<CopyResponse> {
  const {
    remoteUploadFile,
    remoteDownloadFile,
    remoteStatKind
  } = await import('../remote/sessionPool')
  const { parseRemoteLocation, formatRemoteLocation, remoteJoin, remoteBasename } =
    await import('@shared/remotePaths')
  const { app } = await import('electron')
  const scratchRoot = path.join(app.getPath('userData'), 'remote-transfer-scratch')
  await fsp.mkdir(scratchRoot, { recursive: true })

  const copied: string[] = []
  const skipped: string[] = []
  const issues: OpIssue[] = []
  const progress = beginOp('copy', sources.length, 'Transferring…')
  try {
    for (const source of sources) {
      progress.throwIfCancelled()
      const name = source.toLowerCase().startsWith('mfe-remote://')
        ? remoteBasename(parseRemoteLocation(source)?.remotePath ?? '') || 'file'
        : path.basename(source)
      progress.pulse(source)
      try {
        const destIsRemote = destinationDir.toLowerCase().startsWith('mfe-remote://')
        const srcIsRemote = source.toLowerCase().startsWith('mfe-remote://')

        if (destIsRemote) {
          const destUri = remoteJoin(
            parseRemoteLocation(destinationDir)?.remotePath ?? '/',
            name
          )
          const destFull = formatRemoteLocation(
            parseRemoteLocation(destinationDir)!.connectionId,
            destUri!
          )
          const exists = (await remoteStatKind(destFull)) != null
          if (exists && policy === 'skip') {
            skipped.push(source)
            progress.tick(source)
            continue
          }
          if (exists && policy === 'fail') {
            issues.push({
              kind: 'name_conflict',
              code: 'conflict',
              source,
              dest: destFull,
              message: `"${name}" already exists on the remote`
            })
            progress.tick(source)
            continue
          }
          if (exists && policy === 'replace') {
            const { remoteDelete } = await import('../remote/sessionPool')
            await remoteDelete(destFull)
          }

          if (srcIsRemote) {
            const tmp = path.join(scratchRoot, `${Date.now()}-${name}`)
            const kind = await remoteStatKind(source)
            if (kind === 'dir') {
              throw new AppError(
                'not-allowed',
                'Folder transfer between remotes is not supported yet — download then upload'
              )
            }
            await remoteDownloadFile(source, tmp)
            try {
              copied.push(await remoteUploadFile(tmp, destinationDir, name))
            } finally {
              await fsp.rm(tmp, { force: true }).catch(() => undefined)
            }
          } else {
            const st = await fsp.stat(source)
            if (st.isDirectory()) {
              throw new AppError(
                'not-allowed',
                'Uploading folders is not supported yet — zip locally or upload files'
              )
            }
            copied.push(await remoteUploadFile(source, destinationDir, name))
          }
        } else if (srcIsRemote) {
          const target = path.join(destinationDir, name)
          if (await pathExists(target)) {
            if (policy === 'skip') {
              skipped.push(source)
              progress.tick(source)
              continue
            }
            if (policy === 'fail') {
              issues.push({
                kind: 'name_conflict',
                code: 'conflict',
                source,
                dest: target,
                message: `"${name}" already exists`,
                sourceMtimeMs: await mtimeMsOf(source),
                destMtimeMs: await mtimeMsOf(target)
              })
              progress.tick(source)
              continue
            }
            if (policy === 'replace') {
              await fsp.rm(target, { recursive: true, force: true })
            }
          }
          const kind = await remoteStatKind(source)
          if (kind === 'dir') {
            throw new AppError(
              'not-allowed',
              'Downloading remote folders is not supported yet — download files individually'
            )
          }
          await remoteDownloadFile(source, target)
          copied.push(target)
        }
        progress.tick(source)
      } catch (e) {
        if (isCancelled(e)) throw e
        issues.push(await toIssue(e, 'copy', source))
        progress.tick(source)
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    if (isCancelled(e)) return { copied, skipped, issues, aborted: 'cancelled' }
    throw e
  }
  return { copied, skipped, issues }
}

export async function copyEntries(
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy
): Promise<CopyResponse> {
  const dest = requireAbsolute(destinationDir)
  const absSources = sources.map((s) => requireAbsolute(s))
  const destRemote = dest.toLowerCase().startsWith('mfe-remote://')
  const anyRemote = destRemote || absSources.some((s) => s.toLowerCase().startsWith('mfe-remote://'))
  if (anyRemote) {
    return copyWithRemotes(absSources, dest, policy)
  }

  const plan = await planTransfer(sources, destinationDir, policy)
  const copied: string[] = []
  const skipped: string[] = []
  const issues: OpIssue[] = []
  for (const item of plan) {
    if ('skip' in item) skipped.push(item.skip)
  }

  const progress = beginOp('copy', 0, 'Copying…')
  let fatal = false
  try {
    for (const item of plan) {
      progress.throwIfCancelled()
      if ('skip' in item) continue
      if (fatal) {
        const src = item.source
        const dest = item.target
        issues.push({
          kind: 'fatal',
          code: 'io',
          source: src,
          dest,
          message: 'Stopped because the destination is full or missing'
        })
        continue
      }
      if ('conflict' in item) {
        issues.push({
          kind: 'name_conflict',
          code: 'conflict',
          source: item.source,
          dest: item.target,
          message: `"${path.basename(item.source)}" already exists in destination`,
          sourceMtimeMs: await mtimeMsOf(item.source),
          destMtimeMs: await mtimeMsOf(item.target)
        })
        continue
      }
      let isDir = false
      try {
        isDir = (await fsp.stat(item.source)).isDirectory()
      } catch {
        /* ignore */
      }
      try {
        if (policy === 'replace' && (await pathExists(item.target))) {
          await fsp.rm(item.target, { recursive: true, force: true })
        }
        await copyTree(item.source, item.target, progress, { notifyParentOnCreate: true })
        copied.push(item.target)
      } catch (e) {
        if (isCancelled(e)) throw e
        const issue = await toIssue(e, 'copy', item.source, item.target, isDir)
        issues.push(issue)
        if (issue.kind === 'fatal') fatal = true
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    if (isCancelled(e)) return { copied, skipped, issues, aborted: 'cancelled' }
    throw e
  }
  return { copied, skipped, issues, aborted: fatal ? 'fatal' : undefined }
}

async function relocateOne(
  source: string,
  target: string,
  progress: OpReporter | null
): Promise<void> {
  progress?.throwIfCancelled()
  if (source === target) {
    progress?.addToTotal(1, source)
    progress?.tick(source)
    return
  }
  const caseOnly =
    process.platform === 'win32' && source.toLowerCase() === target.toLowerCase()
  if (!caseOnly && (await pathExists(target))) {
    throw new AppError('conflict', `"${path.basename(target)}" already exists`)
  }
  await fsp.mkdir(path.dirname(target), { recursive: true }).catch((e: unknown) => {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
    // Drive roots (Z:\) exist but mkdir is EPERM on Windows — ignore if parent is there.
    if ((code === 'EPERM' || code === 'EEXIST') && fs.existsSync(path.dirname(target))) return
    throw e
  })
  let isDir = false
  try {
    isDir = (await fsp.stat(source)).isDirectory()
  } catch {
    /* ignore */
  }
  // Close watches on the item and ancestors (parent listing watch blocks rename).
  releaseWatchersAffecting([source])
  muteWatchers(400)

  let counted = 0
  if (isDir && progress) {
    counted = await countWorkUnits([source], progress)
    progress.setTotal(counted, source)
    progress.setDone(0, source)
  }

  progress?.pulse(source)
  const heartbeat = progress
    ? setInterval(() => progress.pulse(source), 500)
    : null
  try {
    try {
      await fsp.rename(source, target)
      if (isDir && counted > 0) progress?.setDone(counted, target)
      else {
        progress?.addToTotal(1, target)
        progress?.tick(target)
      }
    } catch (e) {
      const code = e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : ''
      if (code === 'EXDEV') {
        if (heartbeat) {
          clearInterval(heartbeat)
        }
        if (isDir && counted > 0) {
          progress?.setDone(0, source)
          await copyTree(source, target, progress, {
            notifyParentOnCreate: true,
            discover: false
          })
        } else {
          await copyTree(source, target, progress, { notifyParentOnCreate: true })
        }
        await deleteTree(source, null)
      } else {
        throw await appErrorFromFsFailure(e, { action: 'move', path: source, isDir })
      }
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat)
  }
}

/** Move each path to an exact destination (used for undo/redo of moves & renames). */
export async function relocateEntries(
  pairs: { from: string; to: string }[]
): Promise<{ moved: string[] }> {
  const moved: string[] = []
  const progress = beginOp('relocate', 0, 'Moving…')
  suspendWatching()
  muteWatchers(1500)
  try {
    for (const pair of pairs) {
      progress.throwIfCancelled()
      const source = requireAbsolute(pair.from)
      const target = requireAbsolute(pair.to)
      if (!(await pathExists(source))) {
        throw new AppError('not-found', `Not found: ${source}`)
      }
      assertTransferLegal(source, path.dirname(target))
      await relocateOne(source, target, progress)
      moved.push(target)
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    throw e
  } finally {
    resumeWatching()
  }
  return { moved }
}

export async function moveEntries(
  sources: string[],
  destinationDir: string,
  policy: ConflictPolicy
): Promise<MoveResponse> {
  const dest = requireAbsolute(destinationDir)
  const absSources = sources.map((s) => requireAbsolute(s))
  const anyRemote =
    dest.toLowerCase().startsWith('mfe-remote://') ||
    absSources.some((s) => s.toLowerCase().startsWith('mfe-remote://'))

  if (anyRemote) {
    // Cross-scheme move = copy then delete source (no native rename).
    const { copied, skipped, issues, aborted } = await copyWithRemotes(absSources, dest, policy)
    const { remoteDelete } = await import('../remote/sessionPool')
    const moves: { from: string; to: string }[] = []
    const moved: string[] = []
    let copyIdx = 0
    for (const source of absSources) {
      if (skipped.includes(source)) continue
      if (issues.some((i) => i.source === source)) continue
      const target = copied[copyIdx++]
      if (!target) continue
      moved.push(target)
      moves.push({ from: source, to: target })
      try {
        if (source.toLowerCase().startsWith('mfe-remote://')) {
          await remoteDelete(source)
        } else {
          await fsp.rm(source, { recursive: true, force: true })
        }
      } catch (e) {
        issues.push(await toIssue(e, 'move', source, target))
      }
    }
    return { moved, moves, skipped, issues, aborted }
  }

  const plan = await planTransfer(sources, destinationDir, policy)
  const moved: string[] = []
  const moves: { from: string; to: string }[] = []
  const skipped: string[] = []
  const issues: OpIssue[] = []
  for (const item of plan) {
    if ('skip' in item) skipped.push(item.skip)
  }

  const progress = beginOp('move', 0, 'Moving…')
  suspendWatching()
  muteWatchers(1500)
  let fatal = false
  try {
    for (const item of plan) {
      progress.throwIfCancelled()
      if ('skip' in item) continue
      if (fatal) {
        issues.push({
          kind: 'fatal',
          code: 'io',
          source: item.source,
          dest: item.target,
          message: 'Stopped because the destination is full or missing'
        })
        continue
      }
      if ('conflict' in item) {
        issues.push({
          kind: 'name_conflict',
          code: 'conflict',
          source: item.source,
          dest: item.target,
          message: `"${path.basename(item.source)}" already exists in destination`,
          sourceMtimeMs: await mtimeMsOf(item.source),
          destMtimeMs: await mtimeMsOf(item.target)
        })
        continue
      }
      try {
        if (policy === 'replace' && (await pathExists(item.target))) {
          await fsp.rm(item.target, { recursive: true, force: true })
        }
        await relocateOne(item.source, item.target, progress)
        moved.push(item.target)
        moves.push({ from: item.source, to: item.target })
      } catch (e) {
        if (isCancelled(e)) throw e
        const issue = await toIssue(e, 'move', item.source, item.target)
        issues.push(issue)
        if (issue.kind === 'fatal') fatal = true
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    if (isCancelled(e)) return { moved, moves, skipped, issues, aborted: 'cancelled' }
    throw e
  } finally {
    resumeWatching()
  }
  return { moved, moves, skipped, issues, aborted: fatal ? 'fatal' : undefined }
}

export async function trashEntries(paths: string[]): Promise<TrashResponse> {
  const issues: OpIssue[] = []
  const absolute: string[] = []
  for (const raw of paths) {
    const p = requireAbsolute(raw)
    if (isVolumeRootPath(p)) continue
    if (p.toLowerCase().startsWith('mfe-remote://')) {
      issues.push({
        kind: 'not_allowed',
        code: 'not-allowed',
        source: p,
        message: 'Recycle Bin is not available on remote repositories — use permanent Delete'
      })
      continue
    }
    if (!(await pathExists(p))) {
      issues.push({
        kind: 'not_found',
        code: 'not-found',
        source: p,
        message: `Not found: ${p}`
      })
      continue
    }
    absolute.push(p)
  }

  suspendWatching()
  muteWatchers(8000)

  const trashed: string[] = []
  const progress = beginOp('trash', Math.max(absolute.length, 1), 'Moving to Recycle Bin…')
  try {
    for (const p of absolute) {
      progress.throwIfCancelled()
      progress.pulse(p)
      try {
        if (process.platform === 'win32') {
          try {
            await recyclePathWin32Robust(p)
          } catch (e) {
            if (e instanceof AppError && e.code === 'validation') throw e
            if (!fs.existsSync(p)) {
              trashed.push(p)
              progress.tick(p)
              continue
            }
            await new Promise<void>((r) => setTimeout(r, 40))
            await recyclePathWin32Robust(p)
          }
        } else {
          await shell.trashItem(p)
        }
        trashed.push(p)
        progress.tick(p)
      } catch (e) {
        if (isCancelled(e)) throw e
        issues.push(await toIssue(e, 'delete', p))
        progress.tick(p)
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    if (isCancelled(e)) return { trashed, issues, aborted: 'cancelled' }
    throw e
  } finally {
    muteWatchers(8000)
    resumeWatching()
  }
  return { trashed, issues }
}

export async function deletePermanently(paths: string[]): Promise<DeletePermanentResponse> {
  const absolute: string[] = []
  for (const raw of paths) {
    const p = requireAbsolute(raw)
    if (isVolumeRootPath(p)) continue
    absolute.push(p)
  }
  const remotes = absolute.filter((p) => p.toLowerCase().startsWith('mfe-remote://'))
  const locals = absolute.filter((p) => !p.toLowerCase().startsWith('mfe-remote://'))
  const deleted: string[] = []
  const issues: OpIssue[] = []
  if (remotes.length > 0) {
    const { remoteDelete } = await import('../remote/sessionPool')
    const progress = beginOp('delete', remotes.length, 'Deleting…')
    try {
      for (const p of remotes) {
        progress.throwIfCancelled()
        progress.pulse(p)
        try {
          await remoteDelete(p)
          deleted.push(p)
        } catch (e) {
          if (isCancelled(e)) throw e
          issues.push(await toIssue(e, 'delete', p))
        }
        progress.tick(p)
      }
      progress.finish()
    } catch (e) {
      progress.fail()
      if (isCancelled(e)) return { deleted, issues, aborted: 'cancelled' }
      throw e
    }
  }
  if (locals.length === 0) return { deleted, issues }

  const total = locals.length > 0 ? await countWorkUnits(locals) : 0
  const progress = beginOp('delete', Math.max(total, 1), 'Deleting…')
  try {
    for (const p of locals) {
      progress.throwIfCancelled()
      let isDir = false
      try {
        isDir = (await fsp.stat(p)).isDirectory()
      } catch {
        /* ignore */
      }
      releaseWatchersAffecting([p])
      muteWatchers(8000)
      try {
        await deleteTree(p, progress)
        deleted.push(p)
      } catch (e) {
        if (isCancelled(e)) throw e
        issues.push(await toIssue(e, 'delete', p, undefined, isDir))
      }
    }
    progress.finish()
  } catch (e) {
    progress.fail()
    if (isCancelled(e)) return { deleted, issues, aborted: 'cancelled' }
    throw e
  } finally {
    muteWatchers(8000)
  }
  return { deleted, issues }
}

export async function resolveOpIssues(req: ResolveIssuesRequest): Promise<ResolveIssuesResponse> {
  const out: ResolveIssuesResponse = {
    copied: [],
    moved: [],
    moves: [],
    trashed: [],
    deleted: [],
    skipped: 0,
    issues: []
  }
  const dest = req.destinationDir
  const work = req.items.filter((it) => it.decision !== 'skip')
  out.skipped = req.items.length - work.length

  if (req.op === 'rename') {
    for (const it of work) {
      const d = resolveIssueDecision(it.decision, it)
      if (d === 'skip') {
        out.skipped += 1
        continue
      }
      if (!it.dest) {
        out.issues.push({
          kind: 'io',
          code: 'validation',
          source: it.source,
          message: 'Rename review is missing the destination path'
        })
        continue
      }
      try {
        const res = await renameEntry(
          it.source,
          entryBasename(it.dest),
          d === 'retry' ? 'fail' : d
        )
        out.moved.push(res.path)
        out.moves.push({ from: it.source, to: res.path })
      } catch (e) {
        out.issues.push(await toIssue(e, 'move', it.source, it.dest))
      }
    }
    return out
  }

  if (req.op === 'trash') {
    const paths = work.map((it) => it.source)
    if (paths.length === 0) return out
    const res = await trashEntries(paths)
    out.trashed = res.trashed
    out.issues = res.issues
    return out
  }
  if (req.op === 'delete') {
    const paths = work.map((it) => it.source)
    if (paths.length === 0) return out
    const res = await deletePermanently(paths)
    out.deleted = res.deleted
    out.issues = res.issues
    return out
  }

  if (!dest) {
    throw new AppError('validation', 'Destination folder is required to resolve copy/move issues')
  }

  const replace: string[] = []
  const rename: string[] = []
  const retry: string[] = []
  for (const it of work) {
    const d = resolveIssueDecision(it.decision, it)
    if (d === 'skip') {
      out.skipped += 1
      continue
    }
    if (d === 'rename') rename.push(it.source)
    else if (d === 'replace') replace.push(it.source)
    else retry.push(it.source)
  }

  const run = req.op === 'copy' ? copyEntries : moveEntries
  if (replace.length > 0) {
    const res = await run(replace, dest, 'replace')
    if ('copied' in res && req.op === 'copy') out.copied.push(...res.copied)
    if ('moved' in res && req.op === 'move') {
      out.moved.push(...res.moved)
      out.moves.push(...res.moves)
    }
    out.skipped += res.skipped.length
    out.issues.push(...res.issues)
  }
  if (rename.length > 0) {
    const res = await run(rename, dest, 'rename')
    if ('copied' in res && req.op === 'copy') out.copied.push(...res.copied)
    if ('moved' in res && req.op === 'move') {
      out.moved.push(...res.moved)
      out.moves.push(...res.moves)
    }
    out.skipped += res.skipped.length
    out.issues.push(...res.issues)
  }
  if (retry.length > 0) {
    const res = await run(retry, dest, 'fail')
    if ('copied' in res && req.op === 'copy') out.copied.push(...res.copied)
    if ('moved' in res && req.op === 'move') {
      out.moved.push(...res.moved)
      out.moves.push(...res.moves)
    }
    out.skipped += res.skipped.length
    out.issues.push(...res.issues)
  }
  return out
}
