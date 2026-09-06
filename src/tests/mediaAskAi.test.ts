import { describe, expect, it } from 'vitest'
import { topicSubtreeIds, childrenOfTopic, expandedTopicsFromUi } from '../shared/aiChat'
import {
  buildMediaAskAiSystemPrompt,
  buildMediaAskAiUserPrompt,
  mediaAskAiCardFromMeta,
  mediaAskAiMenuItems,
  mediaAskAiSourceContext,
  resolveMediaAskAiKind
} from '../shared/mediaAskAi'
import type { MediaMetadata } from '../shared/mediaMetadata'

const movieMeta = {
  version: 1 as const,
  source: 'manual' as const,
  kind: 'movie' as const,
  title: 'Inception',
  year: 2010,
  genres: ['Sci-Fi'],
  fetchedAt: '2026-01-01T00:00:00.000Z',
  watched: false
} satisfies MediaMetadata

describe('resolveMediaAskAiKind', () => {
  it('uses episode/show/movie from metadata', () => {
    expect(
      resolveMediaAskAiKind({
        isDirectory: false,
        folderOrFileName: 'x.mkv',
        meta: { ...movieMeta, kind: 'episode', showTitle: 'Dexter', title: 'Pilot' }
      })
    ).toBe('episode')
    expect(
      resolveMediaAskAiKind({
        isDirectory: true,
        folderOrFileName: 'Dexter',
        meta: { ...movieMeta, kind: 'show', title: 'Dexter' }
      })
    ).toBe('show')
    expect(
      resolveMediaAskAiKind({
        isDirectory: true,
        folderOrFileName: 'Inception (2010)',
        meta: movieMeta
      })
    ).toBe('movie')
  })

  it('treats Season folders as season when named like a season', () => {
    expect(
      resolveMediaAskAiKind({
        isDirectory: true,
        folderOrFileName: 'Season 01',
        meta: { ...movieMeta, kind: 'show', title: 'Dexter' }
      })
    ).toBe('season')
  })

  it('returns null without a title', () => {
    expect(
      resolveMediaAskAiKind({
        isDirectory: false,
        folderOrFileName: 'x.mkv',
        meta: { ...movieMeta, title: '  ' }
      })
    ).toBeNull()
  })
})

describe('mediaAskAiMenuItems', () => {
  it('returns four items per kind', () => {
    for (const kind of ['movie', 'show', 'season', 'episode'] as const) {
      expect(mediaAskAiMenuItems(kind)).toHaveLength(4)
    }
  })
})

describe('buildMediaAskAiUserPrompt', () => {
  it('is the question only — no metadata dump or path', () => {
    const card = mediaAskAiCardFromMeta('movie', movieMeta, 'Inception (2010)')
    const prompt = buildMediaAskAiUserPrompt(card, 'summary-safe')
    expect(prompt).toMatch(/summary/i)
    expect(prompt).not.toContain('Media metadata')
    expect(prompt).not.toContain('Title:')
    expect(prompt).not.toMatch(/[A-Za-z]:\\/)
    expect(prompt).not.toContain('E:\\')
  })
})

describe('buildMediaAskAiSystemPrompt / sourceContext', () => {
  it('puts identity in system + strip helpers, never paths', () => {
    const card = mediaAskAiCardFromMeta('show', { ...movieMeta, kind: 'show', title: 'Strange New Worlds' }, 'SNW')
    const system = buildMediaAskAiSystemPrompt('list-safe', 'show', card)
    expect(system).toContain('Strange New Worlds')
    expect(system).toContain('Media identity:')
    expect(system).not.toMatch(/[A-Za-z]:\\/)
    const ctx = mediaAskAiSourceContext(card)
    expect(ctx.title).toContain('Strange New Worlds')
    expect(ctx.detail).toBe('Show')
    expect(ctx.feature).toBe('media')
  })
})

describe('expandedTopicsFromUi', () => {
  const topics = [
    { id: 'a', name: 'A', parentId: null, order: 0 },
    { id: 'b', name: 'B', parentId: 'a', order: 0 },
    { id: 'c', name: 'C', parentId: null, order: 1 }
  ]

  it('restores saved expanded ids only', () => {
    expect([...expandedTopicsFromUi(topics, ['a'], 'b')].sort()).toEqual(['a'])
  })

  it('opens roots and path to last topic when nothing saved yet', () => {
    const open = expandedTopicsFromUi(topics, [], 'b')
    expect(open.has('a')).toBe(true)
    expect(open.has('b')).toBe(true)
    expect(open.has('c')).toBe(true)
  })
})
describe('topicSubtreeIds', () => {
  it('includes nested children', () => {
    const topics = [
      { id: 'a', name: 'A', parentId: null, order: 0 },
      { id: 'b', name: 'B', parentId: 'a', order: 0 },
      { id: 'c', name: 'C', parentId: 'b', order: 0 },
      { id: 'd', name: 'D', parentId: null, order: 1 }
    ]
    expect([...topicSubtreeIds(topics, 'a')].sort()).toEqual(['a', 'b', 'c'])
    expect(childrenOfTopic(topics, 'a').map((t) => t.id)).toEqual(['b'])
  })
})
