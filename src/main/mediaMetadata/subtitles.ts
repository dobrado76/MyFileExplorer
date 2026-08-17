import fsp from 'node:fs/promises'
import path from 'node:path'
import { isMediaMetadataVideoName } from '@shared/mediaMetadata'
import {
  isSubsFolderName,
  isSubtitleFileName,
  matchSubsEpisodeFolder,
  pickEnglishSubtitle,
  subtitleExt,
  videoStem
} from '@shared/subtitles'
import { requireAbsolute } from '../fs/list'
import { beginOp } from '../fs/opProgress'
import { recyclePathWin32Robust } from '../fs/trashWin32'

const MAX_WALK = 20_000

export type ConsolidateSubtitlesResult = {
  copied: number
  skipped: number
  recycled: number
  failed: { path: string; message: string }[]
}

async function listDir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function findSubsDir(dir: string, entries: import('node:fs').Dirent[]): Promise<string | null> {
  const hit = entries.find((e) => e.isDirectory() && isSubsFolderName(e.name))
  return hit ? path.join(dir, hit.name) : null
}

async function pickFromEpisodeDir(episodeDir: string): Promise<string | null> {
  const names = (await listDir(episodeDir)).filter((e) => e.isFile()).map((e) => e.name)
  const picked = pickEnglishSubtitle(names)
  return picked ? path.join(episodeDir, picked) : null
}

async function pickFromFlatSubs(subsDir: string, videoFileName: string): Promise<string | null> {
  const stem = videoStem(videoFileName).toLowerCase()
  const files = (await listDir(subsDir)).filter((e) => e.isFile() && isSubtitleFileName(e.name))
  const named = files.filter((e) => videoStem(e.name).toLowerCase().startsWith(stem))
  const picked = pickEnglishSubtitle(named.map((e) => e.name))
  return picked ? path.join(subsDir, picked) : null
}

async function consolidateOneFolder(
  dir: string,
  subsDir: string,
  onlyStems: Set<string> | null
): Promise<{
  copied: number
  skipped: number
  alreadyHad: number
  failed: { path: string; message: string }[]
}> {
  const entries = await listDir(dir)
  const videos = entries.filter((e) => e.isFile() && isMediaMetadataVideoName(e.name))
  const subsKids = await listDir(subsDir)
  const episodeFolders = subsKids.filter((e) => e.isDirectory()).map((e) => e.name)
  let copied = 0
  let skipped = 0
  let alreadyHad = 0
  const failed: { path: string; message: string }[] = []

  for (const video of videos) {
    if (onlyStems && !onlyStems.has(videoStem(video.name).toLowerCase())) continue
    const videoPath = path.join(dir, video.name)
    try {
      const folderName = matchSubsEpisodeFolder(video.name, episodeFolders)
      const src = folderName
        ? await pickFromEpisodeDir(path.join(subsDir, folderName))
        : await pickFromFlatSubs(subsDir, video.name)
      if (!src) {
        skipped += 1
        continue
      }
      const dest = path.join(dir, `${videoStem(video.name)}${subtitleExt(src)}`)
      try {
        await fsp.access(dest)
        alreadyHad += 1
        skipped += 1
        continue
      } catch {
        /* dest free */
      }
      await fsp.copyFile(src, dest)
      copied += 1
    } catch (e) {
      failed.push({
        path: videoPath,
        message: e instanceof Error ? e.message : String(e)
      })
    }
  }

  return { copied, skipped, alreadyHad, failed }
}

async function walkForSubs(
  dir: string,
  visited: number,
  onFolder: (dir: string, subsDir: string) => Promise<void>
): Promise<number> {
  if (visited >= MAX_WALK) return visited
  const entries = await listDir(dir)
  visited += 1
  const subsDir = await findSubsDir(dir, entries)
  if (subsDir) await onFolder(dir, subsDir)
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || isSubsFolderName(e.name)) continue
    visited = await walkForSubs(path.join(dir, e.name), visited, onFolder)
    if (visited >= MAX_WALK) break
  }
  return visited
}

export async function consolidateSubtitles(rawPaths: string[]): Promise<ConsolidateSubtitlesResult> {
  const roots: { dir: string; onlyStems: Set<string> | null }[] = []
  const seen = new Set<string>()
  for (const raw of rawPaths) {
    const p = requireAbsolute(raw)
    if (p.toLowerCase().startsWith('mfe-remote://')) continue
    let st
    try {
      st = await fsp.stat(p)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      const key = p.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      roots.push({ dir: p, onlyStems: null })
      continue
    }
    if (!isMediaMetadataVideoName(p)) continue
    const dir = path.dirname(p)
    const key = dir.toLowerCase()
    let row = roots.find((r) => r.dir.toLowerCase() === key)
    if (!row) {
      row = { dir, onlyStems: new Set() }
      roots.push(row)
      seen.add(key)
    }
    if (row.onlyStems) row.onlyStems.add(videoStem(path.basename(p)).toLowerCase())
  }

  const failed: { path: string; message: string }[] = []
  let copied = 0
  let skipped = 0
  let recycled = 0
  const jobs: { dir: string; subsDir: string; onlyStems: Set<string> | null }[] = []
  for (const root of roots) {
    await walkForSubs(root.dir, 0, async (dir, subsDir) => {
      jobs.push({ dir, subsDir, onlyStems: root.onlyStems })
    })
  }

  const op = beginOp('media-metadata', Math.max(1, jobs.length), 'Consolidating subtitles…')
  try {
    for (const job of jobs) {
      op.throwIfCancelled()
      const r = await consolidateOneFolder(job.dir, job.subsDir, job.onlyStems)
      copied += r.copied
      skipped += r.skipped
      failed.push(...r.failed)
      if (!job.onlyStems && r.failed.length === 0 && (r.copied > 0 || r.alreadyHad > 0)) {
        try {
          if (process.platform === 'win32') await recyclePathWin32Robust(job.subsDir)
          else await fsp.rm(job.subsDir, { recursive: true, force: true })
          recycled += 1
        } catch (e) {
          failed.push({
            path: job.subsDir,
            message: e instanceof Error ? e.message : String(e)
          })
        }
      }
      op.tick(path.basename(job.dir))
    }
    op.finish()
  } catch (e) {
    op.fail()
    throw e
  }

  return { copied, skipped, recycled, failed }
}
