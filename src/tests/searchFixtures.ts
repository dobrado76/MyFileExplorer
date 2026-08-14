import {
  parseEverythingQuery,
  rowMatchesStructured,
  type ParseOptions
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
  { path: 'C:\\Data\\backup.bak', name: 'backup.bak', size: 256, mtimeMs: 1_700_000_000_000, isDir: false },
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
