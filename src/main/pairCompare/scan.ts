import fsp from 'node:fs/promises'
import path from 'node:path'
import { classifyPair, buildRow } from '@shared/pairCompare/classify'
import {
  emptyCounts,
  isPathUnder,
  normalizeRelativePath
} from '@shared/pairCompare/pathUtils'
import type {
  CompareEntryKind,
  CompareEntrySnapshot,
  PairCompareOptions,
  PairCompareRow,
  PairComparisonResult
} from '@shared/pairCompare/types'
import { requireAbsolute } from '../fs/list'
import { HashCache } from './hash'

export type ScanProgress = {
  sessionId: string
  phase: 'discover' | 'hash' | 'done' | 'cancelled'
  itemsScanned: number
  currentRelativePath?: string
  filesHashed?: number
  bytesHashed?: number
}

type SideMap = Map<string, CompareEntrySnapshot>

function resolveCaseSensitive(opt: PairCompareOptions['caseSensitive']): boolean {
  if (opt === true) return true
  if (opt === false) return false
  return process.platform !== 'win32'
}

function kindFromDirent(
  ent: { isDirectory(): boolean; isSymbolicLink(): boolean; isFile(): boolean },
  isJunction: boolean
): CompareEntryKind {
  if (isJunction) return 'junction'
  if (ent.isSymbolicLink()) return 'symlink'
  if (ent.isDirectory()) return 'directory'
  if (ent.isFile()) return 'file'
  return 'other'
}

async function detectJunction(abs: string): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    const st = await fsp.lstat(abs)
    // Windows junctions report as directories with reparse; Node marks isSymbolicLink for junctions too.
    return st.isSymbolicLink() && st.isDirectory()
  } catch {
    return false
  }
}

async function snapshotOf(
  abs: string,
  relativePath: string,
  entKind: CompareEntryKind
): Promise<CompareEntrySnapshot> {
  let size: number | null = null
  let modifiedMs: number | null = null
  let createdMs: number | null = null
  let kind = entKind
  try {
    const st = await fsp.lstat(abs)
    modifiedMs = st.mtimeMs
    createdMs = st.birthtimeMs
    if (st.isSymbolicLink()) {
      const junc = await detectJunction(abs)
      kind = junc ? 'junction' : 'symlink'
    } else if (st.isDirectory()) {
      kind = 'directory'
    } else if (st.isFile()) {
      kind = 'file'
      size = st.size
    } else {
      kind = 'other'
      size = st.size
    }
  } catch {
    /* leave nulls */
  }
  return {
    absolutePath: abs,
    relativePath,
    kind,
    size,
    modifiedMs,
    createdMs
  }
}

async function walkSide(
  root: string,
  options: PairCompareOptions,
  caseSensitive: boolean,
  signal: AbortSignal,
  onProgress: (rel: string) => void,
  errors: { relativePath: string; message: string }[]
): Promise<{ map: SideMap; incomplete: boolean }> {
  const map: SideMap = new Map()
  let incomplete = false
  const visited = new Set<string>()

  async function visit(absDir: string, relDir: string, depth: number): Promise<void> {
    if (signal.aborted) return
    const realKey = absDir.toLowerCase()
    if (visited.has(realKey)) return
    visited.add(realKey)

    let ents: import('node:fs').Dirent[]
    try {
      ents = await fsp.readdir(absDir, { withFileTypes: true })
    } catch (e) {
      incomplete = true
      errors.push({
        relativePath: relDir || '.',
        message: e instanceof Error ? e.message : String(e)
      })
      return
    }

    for (const ent of ents) {
      if (signal.aborted) return
      const name = String(ent.name)
      if (name === '.' || name === '..') continue
      // Hidden: approximate via Windows-style leading-dot + system folders
      if (!options.includeHidden) {
        if (name.startsWith('.')) continue
        if (/^(System Volume Information|\$RECYCLE\.BIN)$/i.test(name)) continue
      }
      const abs = path.join(absDir, name)
      const rel = relDir ? `${relDir}/${name}` : name
      onProgress(rel)

      let isLink = false
      try {
        isLink = ent.isSymbolicLink()
      } catch {
        /* keep false */
      }

      const kind = kindFromDirent(ent, false)
      const snap = await snapshotOf(abs, rel, kind)
      const key = normalizeRelativePath(rel, caseSensitive)
      map.set(key, snap)

      const shouldRecurse =
        options.includeSubfolders &&
        (snap.kind === 'directory' ||
          (options.followLinks && (snap.kind === 'symlink' || snap.kind === 'junction')))

      if (shouldRecurse && depth < 64) {
        if (isLink && !options.followLinks) {
          /* link object only */
        } else if (isLink && options.followLinks) {
          try {
            const real = await fsp.realpath(abs)
            if (!isPathUnder(root, real, caseSensitive)) continue
            await visit(real, rel, depth + 1)
          } catch (e) {
            incomplete = true
            errors.push({
              relativePath: rel,
              message: e instanceof Error ? e.message : String(e)
            })
          }
        } else if (snap.kind === 'directory') {
          await visit(abs, rel, depth + 1)
        }
      }
    }
  }

  await visit(root, '', 0)
  return { map, incomplete }
}

function needsHash(
  method: PairCompareOptions['compareMethod'],
  left: CompareEntrySnapshot | null,
  right: CompareEntrySnapshot | null
): boolean {
  if (!left || !right) return false
  if (left.kind !== 'file' || right.kind !== 'file') return false
  if (method === 'hash_all') return true
  if (method === 'hash_when_needed') {
    if (left.size !== right.size) return false
    // Same size — hash to confirm
    return true
  }
  return false
}

export async function runPairCompare(input: {
  sessionId: string
  leftRoot: string
  rightRoot: string
  options: PairCompareOptions
  signal: AbortSignal
  onProgress: (p: ScanProgress) => void
}): Promise<PairComparisonResult> {
  const leftRoot = requireAbsolute(input.leftRoot)
  const rightRoot = requireAbsolute(input.rightRoot)
  const caseSensitive = resolveCaseSensitive(input.options.caseSensitive)
  const errors: { relativePath: string; message: string }[] = []
  let itemsScanned = 0

  const report = (rel: string): void => {
    itemsScanned++
    if (itemsScanned % 25 === 0 || itemsScanned < 10) {
      input.onProgress({
        sessionId: input.sessionId,
        phase: 'discover',
        itemsScanned,
        currentRelativePath: rel
      })
    }
  }

  const [leftWalk, rightWalk] = await Promise.all([
    walkSide(leftRoot, input.options, caseSensitive, input.signal, report, errors),
    walkSide(rightRoot, input.options, caseSensitive, input.signal, report, errors)
  ])

  if (input.signal.aborted) {
    input.onProgress({
      sessionId: input.sessionId,
      phase: 'cancelled',
      itemsScanned
    })
    throw new Error('cancelled')
  }

  const keys = new Set<string>([...leftWalk.map.keys(), ...rightWalk.map.keys()])
  const rows: PairCompareRow[] = []
  const hashCache = new HashCache(input.signal)
  let filesHashed = 0
  let bytesHashed = 0

  const method = input.options.compareMethod
  if (method === 'hash_when_needed' || method === 'hash_all') {
    input.onProgress({
      sessionId: input.sessionId,
      phase: 'hash',
      itemsScanned,
      filesHashed: 0,
      bytesHashed: 0
    })
  }

  for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
    if (input.signal.aborted) throw new Error('cancelled')
    let left = leftWalk.map.get(key) ?? null
    let right = rightWalk.map.get(key) ?? null
    const displayRel = left?.relativePath ?? right?.relativePath ?? key

    if (needsHash(method, left, right)) {
      try {
        if (left) {
          const h = await hashCache.get(left.absolutePath, left.size, left.modifiedMs)
          left = { ...left, hash: h }
          filesHashed++
          bytesHashed += left.size ?? 0
        }
        if (right) {
          const h = await hashCache.get(right.absolutePath, right.size, right.modifiedMs)
          right = { ...right, hash: h }
          filesHashed++
          bytesHashed += right.size ?? 0
        }
        input.onProgress({
          sessionId: input.sessionId,
          phase: 'hash',
          itemsScanned,
          filesHashed,
          bytesHashed,
          currentRelativePath: displayRel
        })
      } catch (e) {
        if (input.signal.aborted) throw new Error('cancelled', { cause: e })
        errors.push({
          relativePath: displayRel,
          message: e instanceof Error ? e.message : String(e)
        })
        const { status, reason } = classifyPair(left, right, input.options)
        rows.push({
          id: key || '__root__',
          relativePath: displayRel,
          depth: displayRel.split('/').filter(Boolean).length
            ? displayRel.split('/').filter(Boolean).length - 1
            : 0,
          left,
          right,
          status: status === 'identical' ? 'inaccessible' : status,
          reason: reason + ' (hash failed)'
        })
        continue
      }
    }

    rows.push(
      buildRow(displayRel, left, right, {
        ...input.options,
        caseSensitive
      })
    )
  }

  hashCache.clear()

  let filtered = rows
  if (input.options.ignoreEmptyFolders) {
    const folderKeys = new Set(
      rows
        .filter(
          (r) =>
            (r.left?.kind === 'directory' || r.right?.kind === 'directory') &&
            r.status === 'identical'
        )
        .map((r) => r.relativePath.replace(/\\/g, '/'))
    )
    const hasDescendant = (folder: string): boolean =>
      rows.some((r) => {
        const rel = r.relativePath.replace(/\\/g, '/')
        return rel !== folder && rel.startsWith(folder + '/')
      })
    filtered = rows.filter((r) => {
      const rel = r.relativePath.replace(/\\/g, '/')
      if (!folderKeys.has(rel)) return true
      return hasDescendant(rel)
    })
  }

  const counts = emptyCounts()
  for (const r of filtered) counts[r.status]++

  input.onProgress({
    sessionId: input.sessionId,
    phase: 'done',
    itemsScanned,
    filesHashed,
    bytesHashed
  })

  return {
    sessionId: input.sessionId,
    leftRoot,
    rightRoot,
    options: input.options,
    createdAt: Date.now(),
    rows: filtered,
    counts,
    incomplete: leftWalk.incomplete || rightWalk.incomplete,
    scanErrors: errors
  }
}
