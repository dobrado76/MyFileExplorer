import { describe, expect, it } from 'vitest'
import type { DirEntry } from '../shared/schemas/fs'
import { buildEpisodeSortLookup, episodeSortTuple } from '../shared/mediaMetadata'
import { sortEntries } from '../renderer/lib/sortEntries'

function file(name: string, path: string): DirEntry {
  return {
    name,
    path,
    kind: 'file',
    ext: 'mkv',
    size: 1,
    mtimeMs: 0,
    birthtimeMs: 0,
    isHidden: false
  }
}

describe('sortEntries Name + episode air order', () => {
  it('orders by season/episode when both have metadata (ignores rip filename order)', () => {
    // Filenames omit SxxExx (or use a scene order that is not air order).
    const s02 = file(
      'Mayor.of.Kingstown.Never.Missed.a.Pigeon.mkv',
      'C:\\Shows\\Mayor\\Mayor.of.Kingstown.Never.Missed.a.Pigeon.mkv'
    )
    const s01 = file(
      'Mayor.of.Kingstown.The.Mayor.of.Kingstown.mkv',
      'C:\\Shows\\Mayor\\Mayor.of.Kingstown.The.Mayor.of.Kingstown.mkv'
    )
    const s03 = file(
      'Mayor.of.Kingstown.Soldiers.Heart.mkv',
      'C:\\Shows\\Mayor\\Mayor.of.Kingstown.Soldiers.Heart.mkv'
    )
    const byPath: Record<string, { kind: 'episode'; season: number; episode: number }> = {
      [s02.path.toLowerCase()]: { kind: 'episode', season: 2, episode: 1 },
      [s01.path.toLowerCase()]: { kind: 'episode', season: 1, episode: 1 },
      [s03.path.toLowerCase()]: { kind: 'episode', season: 3, episode: 1 }
    }

    const byName = sortEntries([s02, s01, s03], { key: 'name', dir: 'asc' }, false)
    // Title stems: Never…, Soldiers…, The Mayor… — not air order.
    expect(byName.map((e) => e.path)).not.toEqual([s01.path, s02.path, s03.path])

    const ordered = sortEntries([s02, s03, s01], { key: 'name', dir: 'asc' }, false, {
      episodeOrder: (p) => episodeSortTuple(byPath[p.toLowerCase()])
    })
    expect(ordered.map((e) => e.path)).toEqual([s01.path, s02.path, s03.path])
  })

  it('parses SxxExx from rip filenames when year junk would beat season order', () => {
    const s02 = file(
      'Mayor.of.Kingstown.2021.S02E01.Never.Missed.a.Pigeon.mkv',
      'C:\\Shows\\Mayor\\Mayor.of.Kingstown.2021.S02E01.Never.Missed.a.Pigeon.mkv'
    )
    const s01 = file(
      'Mayor.of.Kingstown.S01E01.The.Mayor.of.Kingstown.mkv',
      'C:\\Shows\\Mayor\\Mayor.of.Kingstown.S01E01.The.Mayor.of.Kingstown.mkv'
    )
    // Digit "2021" sorts before letter "S" — filename order puts S02 first.
    const byName = sortEntries([s02, s01], { key: 'name', dir: 'asc' }, false)
    expect(byName[0]!.path).toBe(s02.path)

    const episodeOrder = buildEpisodeSortLookup({}, [s02, s01])
    const ordered = sortEntries([s02, s01], { key: 'name', dir: 'asc' }, false, { episodeOrder })
    expect(ordered.map((e) => e.path)).toEqual([s01.path, s02.path])
  })
})
