import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { AppError } from '@shared/result'
import type {
  DriveProperties,
  FolderMeasureResult,
  PropertiesKind,
  PropertiesModel,
  SetAttributesResponse
} from '@shared/schemas/properties'
import { requireAbsolute } from './list'
import {
  attributeLabels,
  flagsFromAttributes,
  getFileAttributes,
  setWinAttributeFlags
} from './winAttrs'

const execFileAsync = promisify(execFile)

const DRIVE_TYPES: Record<number, string> = {
  0: 'Unknown',
  1: 'No Root Directory',
  2: 'Removable Disk',
  3: 'Local Disk',
  4: 'Network Drive',
  5: 'Compact Disc',
  6: 'RAM Disk'
}

function isDriveRoot(abs: string): boolean {
  if (process.platform === 'win32') {
    return /^[a-zA-Z]:\\?$/.test(abs)
  }
  return abs === '/' || abs === path.sep
}

function driveRootPath(abs: string): string {
  if (process.platform === 'win32') {
    const m = /^([a-zA-Z]:)/.exec(abs)
    return m ? `${m[1]}\\` : abs
  }
  return '/'
}

function displayName(abs: string): string {
  if (isDriveRoot(abs)) {
    if (process.platform === 'win32') return abs.slice(0, 2).toUpperCase()
    return abs
  }
  return path.basename(abs) || abs
}

function parentLocation(abs: string): string | null {
  if (isDriveRoot(abs)) return null
  const parent = path.dirname(abs)
  if (!parent || parent === abs) return null
  return parent
}

function typeLabelFor(ext: string, kind: PropertiesKind, drive: DriveProperties | null): string {
  if (kind === 'drive') {
    const fs = drive?.fileSystem
    const dtype = drive?.driveType ?? 'Local Disk'
    return fs ? `${dtype} (${fs})` : dtype
  }
  if (kind === 'dir') return 'File folder'
  if (kind === 'symlink') return 'Symbolic link'
  if (kind === 'missing') return 'Missing'
  if (!ext) return 'File'
  return `${ext.toUpperCase()} file`
}

function readWinAttributes(abs: string): string[] {
  const attrs = getFileAttributes(abs)
  if (attrs === null) return []
  return attributeLabels(flagsFromAttributes(attrs))
}

export function setPathAttributes(
  rawPath: string,
  flags: { readOnly: boolean; hidden: boolean; archive: boolean; system: boolean }
): SetAttributesResponse {
  const abs = requireAbsolute(rawPath)
  if (isDriveRoot(abs)) {
    throw new AppError('validation', 'Cannot change attributes on a drive root')
  }
  const next = setWinAttributeFlags(abs, flags)
  const labels = attributeLabels(next)
  return {
    path: abs,
    attributes: labels.length > 0 ? labels : ['None'],
    readOnly: next.readOnly,
    hidden: next.hidden,
    archive: next.archive,
    system: next.system
  }
}

async function readVolumeMeta(root: string): Promise<{
  volumeLabel: string | null
  fileSystem: string | null
  driveType: string | null
  size: number | null
  freeSpace: number | null
}> {
  if (process.platform !== 'win32') {
    return { volumeLabel: null, fileSystem: null, driveType: null, size: null, freeSpace: null }
  }
  const letter = /^([a-zA-Z]):/.exec(root)?.[1]
  if (!letter) {
    return { volumeLabel: null, fileSystem: null, driveType: null, size: null, freeSpace: null }
  }
  try {
    const cmd = `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${letter.toUpperCase()}:'" | Select-Object VolumeName,FileSystem,Size,FreeSpace,DriveType | ConvertTo-Json -Compress`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', cmd], {
      windowsHide: true,
      timeout: 8000
    })
    const raw = stdout.trim()
    if (!raw) {
      return { volumeLabel: null, fileSystem: null, driveType: null, size: null, freeSpace: null }
    }
    const data = JSON.parse(raw) as {
      VolumeName?: string | null
      FileSystem?: string | null
      Size?: number | null
      FreeSpace?: number | null
      DriveType?: number | null
    }
    const vol = data.VolumeName?.trim() ?? ''
    return {
      volumeLabel: vol && !/^no name$/i.test(vol) && !/^new volume$/i.test(vol) ? vol : null,
      fileSystem: data.FileSystem ?? null,
      driveType:
        data.DriveType != null ? (DRIVE_TYPES[data.DriveType] ?? `Type ${data.DriveType}`) : null,
      size: typeof data.Size === 'number' ? data.Size : null,
      freeSpace: typeof data.FreeSpace === 'number' ? data.FreeSpace : null
    }
  } catch {
    return { volumeLabel: null, fileSystem: null, driveType: null, size: null, freeSpace: null }
  }
}

async function readDriveSpace(root: string): Promise<DriveProperties | null> {
  let capacityBytes = 0
  let freeBytes = 0
  try {
    const s = await fsp.statfs(root)
    capacityBytes = Number(s.blocks) * Number(s.bsize)
    freeBytes = Number(s.bavail) * Number(s.bsize)
  } catch {
    // fall through to CIM sizes
  }

  const meta = await readVolumeMeta(root)
  if (capacityBytes <= 0 && meta.size != null) capacityBytes = meta.size
  if (freeBytes <= 0 && meta.freeSpace != null) freeBytes = meta.freeSpace
  if (capacityBytes <= 0) return null

  freeBytes = Math.min(Math.max(0, freeBytes), capacityBytes)
  const usedBytes = Math.max(0, capacityBytes - freeBytes)
  return {
    capacityBytes,
    freeBytes,
    usedBytes,
    fileSystem: meta.fileSystem,
    volumeLabel: meta.volumeLabel,
    driveType: meta.driveType ?? 'Local Disk'
  }
}

async function countImmediateChildren(
  dir: string
): Promise<{ files: number; folders: number } | null> {
  try {
    const ents = await fsp.readdir(dir, { withFileTypes: true })
    let files = 0
    let folders = 0
    for (const e of ents) {
      if (e.isDirectory()) folders++
      else files++
    }
    return { files, folders }
  } catch {
    return null
  }
}

export async function getProperties(inputPath: string): Promise<PropertiesModel> {
  const abs = requireAbsolute(inputPath)

  if (abs.toLowerCase().startsWith('mfe-remote://')) {
    const { remoteStat } = await import('../remote/sessionPool')
    const {
      parseRemoteLocation,
      remoteBasename,
      remoteParentPath,
      formatRemoteLocation
    } = await import('@shared/remotePaths')
    const loc = parseRemoteLocation(abs)
    const st = await remoteStat(abs)
    const name = loc ? remoteBasename(loc.remotePath) || loc.connectionId : abs
    const parentPosix = loc ? remoteParentPath(loc.remotePath) : null
    const location =
      loc && parentPosix != null
        ? formatRemoteLocation(loc.connectionId, parentPosix)
        : loc
          ? formatRemoteLocation(loc.connectionId, '/')
          : null
    if (!st) {
      return {
        path: abs,
        name,
        location,
        kind: 'missing',
        typeLabel: 'Missing',
        sizeBytes: null,
        contains: null,
        canMeasure: false,
        createdMs: null,
        modifiedMs: null,
        accessedMs: null,
        attributes: [],
        drive: null,
        linkTarget: null
      }
    }
    const kind: PropertiesKind = st.kind === 'dir' ? 'dir' : 'file'
    const ext =
      kind === 'file' && name.includes('.')
        ? name.slice(name.lastIndexOf('.') + 1).toLowerCase()
        : ''
    return {
      path: abs,
      name,
      location,
      kind,
      typeLabel: `${typeLabelFor(ext, kind, null)} (remote)`,
      sizeBytes: kind === 'file' ? st.size : null,
      contains: null,
      canMeasure: false,
      createdMs: null,
      modifiedMs: st.mtimeMs > 0 ? st.mtimeMs : null,
      accessedMs: null,
      attributes: ['Remote'],
      drive: null,
      linkTarget: null
    }
  }

  const name = displayName(abs)
  const location = parentLocation(abs)

  try {
    const st = await fsp.lstat(abs)
    const isLink = st.isSymbolicLink()
    let kind: PropertiesKind
    let linkTarget: string | null = null
    if (isLink) {
      kind = 'symlink'
      try {
        linkTarget = await fsp.readlink(abs)
      } catch {
        linkTarget = null
      }
    } else if (st.isDirectory() && isDriveRoot(abs)) {
      kind = 'drive'
    } else if (st.isDirectory()) {
      kind = 'dir'
    } else {
      kind = 'file'
    }

    // Follow link for size/dates of the target when useful.
    let sizeStat = st
    if (isLink) {
      try {
        sizeStat = await fsp.stat(abs)
      } catch {
        // broken link — keep lstat
      }
    }

    let isReadonly = false
    try {
      await fsp.access(abs, fsp.constants.W_OK)
    } catch {
      isReadonly = true
    }

    const attrs = readWinAttributes(abs)
    if (isReadonly && !attrs.includes('Read-only')) attrs.unshift('Read-only')
    if (process.platform !== 'win32' && name.startsWith('.') && !attrs.includes('Hidden')) {
      attrs.push('Hidden')
    }

    let drive: DriveProperties | null = null
    if (kind === 'drive') {
      drive = await readDriveSpace(driveRootPath(abs))
    }

    const contains =
      kind === 'dir' || kind === 'drive' ? await countImmediateChildren(abs) : null
    const ext = kind === 'file' ? path.extname(name).slice(1).toLowerCase() : ''

    return {
      path: abs,
      name,
      location,
      kind,
      typeLabel: typeLabelFor(ext, kind, drive),
      sizeBytes: kind === 'file' || (kind === 'symlink' && sizeStat.isFile()) ? sizeStat.size : null,
      contains,
      canMeasure: kind === 'dir',
      createdMs: sizeStat.birthtimeMs > 0 ? sizeStat.birthtimeMs : null,
      modifiedMs: sizeStat.mtimeMs > 0 ? sizeStat.mtimeMs : null,
      accessedMs: sizeStat.atimeMs > 0 ? sizeStat.atimeMs : null,
      attributes: attrs.length > 0 ? attrs : ['None'],
      drive,
      linkTarget
    }
  } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && (e as { code: string }).code === 'ENOENT') {
      return {
        path: abs,
        name,
        location,
        kind: 'missing',
        typeLabel: 'Missing',
        sizeBytes: null,
        contains: null,
        canMeasure: false,
        createdMs: null,
        modifiedMs: null,
        accessedMs: null,
        attributes: [],
        drive: null,
        linkTarget: null
      }
    }
    throw e
  }
}

const MEASURE_CONCURRENCY = 32
/** Soft cap so huge trees don't hang the dialog forever. */
const MEASURE_MAX_ENTRIES = 250_000

export async function measureFolder(inputPath: string): Promise<FolderMeasureResult> {
  const root = requireAbsolute(inputPath)
  let totalBytes = 0
  let fileCount = 0
  let folderCount = 0
  let truncated = false
  let visited = 0

  const queue: string[] = [root]
  while (queue.length > 0) {
    const batch = queue.splice(0, MEASURE_CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map(async (dir) => {
        const ents = await fsp.readdir(dir, { withFileTypes: true })
        const nested: string[] = []
        for (const e of ents) {
          visited++
          if (visited > MEASURE_MAX_ENTRIES) {
            truncated = true
            return nested
          }
          const full = path.join(dir, e.name)
          if (e.isSymbolicLink()) {
            // Do not follow links into other trees.
            continue
          }
          if (e.isDirectory()) {
            folderCount++
            nested.push(full)
          } else if (e.isFile()) {
            fileCount++
            try {
              const st = await fsp.stat(full)
              totalBytes += st.size
            } catch {
              // unreadable file
            }
          }
        }
        return nested
      })
    )
    if (truncated) break
    for (const s of settled) {
      if (s.status === 'fulfilled') queue.push(...s.value)
    }
  }

  return { path: root, totalBytes, fileCount, folderCount, truncated }
}
