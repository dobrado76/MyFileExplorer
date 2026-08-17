import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  isEnglishSubtitleName,
  isSubsFolderName,
  matchSubsEpisodeFolder,
  pickEnglishSubtitle,
  videoStem
} from '../shared/subtitles'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { trashItem: vi.fn() }
}))

vi.mock('../main/fs/trashWin32', () => ({
  recyclePathWin32Robust: async (p: string) => {
    await fsp.rm(p, { recursive: true, force: true })
  }
}))

import { consolidateSubtitles } from '../main/mediaMetadata/subtitles'

describe('subtitle helpers', () => {
  it('recognizes Subs folder names', () => {
    expect(isSubsFolderName('Subs')).toBe(true)
    expect(isSubsFolderName('subtitles')).toBe(true)
    expect(isSubsFolderName('SUB')).toBe(true)
    expect(isSubsFolderName('Season 2')).toBe(false)
  })

  it('detects English-tagged subtitle names', () => {
    expect(isEnglishSubtitleName('English.srt')).toBe(true)
    expect(isEnglishSubtitleName('Dexter.S02E01.en.srt')).toBe(true)
    expect(isEnglishSubtitleName('2_English.ass')).toBe(true)
    expect(isEnglishSubtitleName('Spanish.srt')).toBe(false)
    expect(isEnglishSubtitleName('notes.txt')).toBe(false)
  })

  it('matches the episode folder to the video stem', () => {
    expect(
      matchSubsEpisodeFolder('Dexter.S02E01.BDRip.x265-ION265.mp4', [
        'Dexter.S02E01.BDRip.x265-ION265',
        'Dexter.S02E02.BDRip.x265-ION265'
      ])
    ).toBe('Dexter.S02E01.BDRip.x265-ION265')
    expect(videoStem('show.S01E01.mkv')).toBe('show.S01E01')
  })

  it('prefers an English .srt over other languages and formats', () => {
    expect(
      pickEnglishSubtitle(['Spanish.srt', 'English.ass', 'English.srt', 'French.srt'])
    ).toBe('English.srt')
  })

  it('falls back to the only subtitle when nothing is tagged English', () => {
    expect(pickEnglishSubtitle(['Dexter.S02E01.BDRip.x265-ION265.srt'])).toBe(
      'Dexter.S02E01.BDRip.x265-ION265.srt'
    )
    expect(pickEnglishSubtitle(['Spanish.srt', 'French.srt'])).toBeNull()
  })
})

describe('consolidateSubtitles', () => {
  let root = ''

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'mfe-subs-'))
  })

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('copies the English srt next to the video and removes Subs', async () => {
    const season = path.join(root, 'Season 2')
    const ep = 'Dexter.S02E01.BDRip.x265-ION265'
    await fsp.mkdir(path.join(season, 'Subs', ep), { recursive: true })
    await fsp.writeFile(path.join(season, `${ep}.mp4`), 'video')
    await fsp.writeFile(path.join(season, 'Subs', ep, 'English.srt'), 'en')
    await fsp.writeFile(path.join(season, 'Subs', ep, 'Spanish.srt'), 'es')

    const res = await consolidateSubtitles([season])
    expect(res.copied).toBe(1)
    expect(res.recycled).toBe(1)
    expect(res.failed).toEqual([])
    await expect(fsp.readFile(path.join(season, `${ep}.srt`), 'utf8')).resolves.toBe('en')
    await expect(fsp.stat(path.join(season, 'Subs'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('walks nested seasons and leaves Subs when only some videos are selected', async () => {
    const show = path.join(root, 'Dexter')
    const s2 = path.join(show, 'Season 2')
    const ep1 = 'Dexter.S02E01.BDRip.x265-ION265'
    const ep2 = 'Dexter.S02E02.BDRip.x265-ION265'
    await fsp.mkdir(path.join(s2, 'Subs', ep1), { recursive: true })
    await fsp.mkdir(path.join(s2, 'Subs', ep2), { recursive: true })
    await fsp.writeFile(path.join(s2, `${ep1}.mp4`), 'v1')
    await fsp.writeFile(path.join(s2, `${ep2}.mp4`), 'v2')
    await fsp.writeFile(path.join(s2, 'Subs', ep1, `${ep1}.srt`), 'one')
    await fsp.writeFile(path.join(s2, 'Subs', ep2, `${ep2}.srt`), 'two')

    const res = await consolidateSubtitles([path.join(s2, `${ep1}.mp4`)])
    expect(res.copied).toBe(1)
    expect(res.recycled).toBe(0)
    await expect(fsp.readFile(path.join(s2, `${ep1}.srt`), 'utf8')).resolves.toBe('one')
    await expect(fsp.stat(path.join(s2, 'Subs', ep2))).resolves.toBeTruthy()
  })

  it('skips an existing dest and still recycles Subs on a folder run', async () => {
    const season = path.join(root, 'Season 3')
    const ep = 'show.S03E01'
    await fsp.mkdir(path.join(season, 'Subtitles', ep), { recursive: true })
    await fsp.writeFile(path.join(season, `${ep}.mkv`), 'video')
    await fsp.writeFile(path.join(season, `${ep}.srt`), 'already')
    await fsp.writeFile(path.join(season, 'Subtitles', ep, 'en.srt'), 'new')

    const res = await consolidateSubtitles([season])
    expect(res.copied).toBe(0)
    expect(res.skipped).toBe(1)
    expect(res.recycled).toBe(1)
    await expect(fsp.readFile(path.join(season, `${ep}.srt`), 'utf8')).resolves.toBe('already')
    await expect(fsp.stat(path.join(season, 'Subtitles'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
