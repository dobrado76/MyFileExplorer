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

  it('keeps season folders and episodes in air order when name sort is character-by-character', () => {
    const season10 = file('Season 10', 'C:\\Shows\\Show\\Season 10')
    season10.kind = 'dir'
    season10.ext = ''
    const season2 = file('Season 2', 'C:\\Shows\\Show\\Season 2')
    season2.kind = 'dir'
    season2.ext = ''
    const ep10 = file('Show.S01E10.Title.mkv', 'C:\\Shows\\Show\\Season 1\\Show.S01E10.Title.mkv')
    const ep2 = file('Show.S01E2.Title.mkv', 'C:\\Shows\\Show\\Season 1\\Show.S01E2.Title.mkv')

    const byLiteralName = sortEntries([season10, season2], { key: 'name', dir: 'asc' }, true, {
      nameSort: 'literal'
    })
    expect(byLiteralName.map((e) => e.name)).toEqual(['Season 10', 'Season 2'])

    const seasons = sortEntries([season10, season2], { key: 'name', dir: 'asc' }, true, {
      nameSort: 'literal',
      episodeOrder: buildEpisodeSortLookup({}, [season10, season2])
    })
    expect(seasons.map((e) => e.name)).toEqual(['Season 2', 'Season 10'])

    const episodes = sortEntries([ep10, ep2], { key: 'name', dir: 'asc' }, false, {
      nameSort: 'literal',
      episodeOrder: buildEpisodeSortLookup({}, [ep10, ep2])
    })
    expect(episodes.map((e) => e.name)).toEqual(['Show.S01E2.Title.mkv', 'Show.S01E10.Title.mkv'])
  })

  it('Manual sort on a real folder still air-orders when episode metadata is passed', () => {
    const s03 = file(
      'Mayor of Kingstown (2021) - S03E06 - Ecotone.mkv',
      'E:\\Series\\Show\\Mayor of Kingstown (2021) - S03E06 - Ecotone.mkv'
    )
    const s01 = file(
      'Mayor.of.Kingstown.S01E01.The.Mayor.of.Kingstown.mkv',
      'E:\\Series\\Show\\Mayor.of.Kingstown.S01E01.The.Mayor.of.Kingstown.mkv'
    )
    // Space in "Mayor of…" sorts before the dot in "Mayor.of…", so filename
    // order puts season 3 before season 1.
    const kept = sortEntries([s03, s01], { key: 'manual', dir: 'asc' }, false)
    expect(kept.map((e) => e.name)).toEqual([s03.name, s01.name])

    const byPath: Record<string, { kind: 'episode'; season: number; episode: number }> = {
      [s03.path.toLowerCase()]: { kind: 'episode', season: 3, episode: 6 },
      [s01.path.toLowerCase()]: { kind: 'episode', season: 1, episode: 1 }
    }
    const ordered = sortEntries([s03, s01], { key: 'manual', dir: 'asc' }, false, {
      nameSort: 'literal',
      episodeOrder: (p) => episodeSortTuple(byPath[p.toLowerCase()])
    })
    expect(ordered.map((e) => e.name)).toEqual([s01.name, s03.name])
  })
})
