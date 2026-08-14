import {
  parseEverythingQuery,
  rowMatchesStructured,
  type ParseOptions,
  type StructuredQuery
} from '../main/search/everythingQuery'

/** Shared corpus for index post-filter and live-walk advanced matching. */
export type SearchFixtureRow = {
  path: string
  name: string
  size: number
  mtimeMs: number
  isDir: boolean
  attrs?: number | null
}

export const SEARCH_FIXTURES: SearchFixtureRow[] = [
  { path: 'C:\\Data\\photo.jpg', name: 'photo.jpg', size: 2_048_000, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\photo.tmp', name: 'photo.tmp', size: 512, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\readme.txt', name: 'readme.txt', size: 4_096, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\something.txt', name: 'something.txt', size: 128, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\report.pdf', name: 'report.pdf', size: 32_000, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\annual-summary.pdf', name: 'annual-summary.pdf', size: 64_000, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\backup.bak', name: 'backup.bak', size: 256, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\!!Thumbs.db', name: '!!Thumbs.db', size: 80, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\Vacation\\clip.mp4', name: 'clip.mp4', size: 80_000_000, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\Vacation\\notes.txt', name: 'notes.txt', size: 900, mtimeMs: 1_700_000_000_000, isDir: false },
  { path: 'C:\\Data\\Archive', name: 'Archive', size: 0, mtimeMs: 1_700_000_000_000, isDir: true },
  { path: 'C:\\Data\\Vacation', name: 'Vacation', size: 0, mtimeMs: 1_700_000_000_000, isDir: true },
  {
    path: 'C:\\Data\\node_modules\\pkg\\index.js',
    name: 'index.js',
    size: 12_000,
    mtimeMs: 1_700_000_000_000,
    isDir: false
  },
  {
    path: 'C:\\Data\\hidden.dat',
    name: 'hidden.dat',
    size: 64,
    mtimeMs: 1_700_000_000_000,
    isDir: false,
    attrs: 0x2
  },
  { path: 'C:\\Other\\mirror.jpg', name: 'mirror.jpg', size: 1_024, mtimeMs: 1_700_000_000_000, isDir: false }
]

/** Decoy names — if a basic query returns these, the name filter is broken. */
export const SEARCH_DECOYS = ['photo.jpg', 'clip.mp4', 'Archive', 'Vacation', 'mirror.jpg', 'index.js'] as const

/**
 * Toolbar-style basic search cases. Every pipeline (fixture filter, live walk,
 * indexed SQL + post-filter) must honour these — including negative assertions.
 */
export type BasicSearchCase = {
  query: string
  includes: string[]
  excludes: readonly string[]
}

export const BASIC_SEARCH_CASES: BasicSearchCase[] = [
  {
    query: 'something.txt',
    includes: ['something.txt'],
    excludes: SEARCH_DECOYS
  },
  {
    query: 'readme.txt',
    includes: ['readme.txt'],
    excludes: SEARCH_DECOYS
  },
  {
    query: 'report.pdf',
    includes: ['report.pdf'],
    excludes: SEARCH_DECOYS
  },
  {
    query: 'annual-summary.pdf',
    includes: ['annual-summary.pdf'],
    excludes: SEARCH_DECOYS
  },
  {
    query: 'photo.jpg',
    includes: ['photo.jpg'],
    excludes: ['readme.txt', 'something.txt', 'report.pdf', 'Archive', 'Vacation', 'clip.mp4']
  },
  {
    query: 'photo',
    includes: ['photo.jpg', 'photo.tmp'],
    excludes: ['readme.txt', 'something.txt', 'Archive', 'Vacation', 'clip.mp4']
  },
  {
    query: 'nothing-here.xyz',
    includes: [],
    excludes: [...SEARCH_DECOYS, 'readme.txt', 'something.txt', 'report.pdf', 'notes.txt']
  },
  {
    query: '!!Thumbs.db',
    includes: ['!!Thumbs.db'],
    excludes: SEARCH_DECOYS
  }
]

export function filterFixtures(
  query: string,
  opts: ParseOptions = {},
  rootPrefix: string | null = 'C:\\Data'
): SearchFixtureRow[] {
  const q = parseEverythingQuery(query, opts)
  return SEARCH_FIXTURES.filter((row) =>
    rowMatchesStructured(row, q, { rootPrefix, childCount: row.isDir ? 2 : undefined })
  )
}

export function fixtureNames(
  query: string,
  opts: ParseOptions = {},
  rootPrefix: string | null = 'C:\\Data'
): string[] {
  return filterFixtures(query, opts, rootPrefix).map((r) => r.name)
}

/** Simulate indexed SQL returning the whole corpus — post-filter must still narrow. */
export function fixtureNamesAfterWideSqlPull(
  query: string,
  opts: ParseOptions = {},
  rootPrefix: string | null = 'C:\\Data'
): string[] {
  const q = parseEverythingQuery(query, opts)
  return SEARCH_FIXTURES.filter((row) =>
    rowMatchesStructured(row, q, { rootPrefix, childCount: row.isDir ? 2 : undefined })
  ).map((r) => r.name)
}

/** Assert a basic search case against a name list (shared by all pipeline tests). */
export function assertBasicSearchCase(names: string[], spec: BasicSearchCase): void {
  for (const must of spec.includes) {
    if (!names.includes(must)) {
      throw new Error(`query "${spec.query}": expected to include "${must}" but got [${names.join(', ')}]`)
    }
  }
  for (const mustNot of spec.excludes) {
    if (names.includes(mustNot)) {
      throw new Error(`query "${spec.query}": must not include decoy "${mustNot}" but got [${names.join(', ')}]`)
    }
  }
}

/** Old bug: unknown `word:value` produced empty textGroups → everything matched. */
export function simulateBrokenOperatorParse(filename: string): StructuredQuery {
  const q = parseEverythingQuery(filename)
  q.textGroups = []
  q.exts = []
  q.excludeExts = []
  q.pathPrefixes = []
  q.pathContains = []
  q.excludePathContains = []
  q.fileOnly = false
  q.folderOnly = false
  q.size = null
  q.dates = []
  q.empty = null
  q.notText = []
  return q
}
