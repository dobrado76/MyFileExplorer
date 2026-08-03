import { describe, expect, it } from 'vitest'
import {
  folderViewSummary,
  resolveFolderView,
  upsertFolderView,
  type FolderView
} from '@shared/folderViews'

const base = {
  viewMode: 'details' as const,
  sort: { key: 'name' as const, dir: 'asc' as const },
  detailsColumns: [{ id: 'mtime' as const, width: 150 }],
  detailsNameWidth: 320
}

function fv(
  path: string,
  recursive: boolean,
  viewMode: FolderView['viewMode'] = 'details'
): FolderView {
  return { path, recursive, ...base, viewMode }
}

describe('resolveFolderView', () => {
  it('prefers exact over recursive ancestor', () => {
    const list = [fv('E:\\Media', true, 'largeIcons'), fv('E:\\Media\\Photos', false, 'details')]
    expect(resolveFolderView('E:\\Media\\Photos', list)?.viewMode).toBe('details')
    expect(resolveFolderView('E:\\Media\\Photos\\2024', list)?.viewMode).toBe('largeIcons')
  })

  it('picks longest recursive ancestor', () => {
    const list = [fv('E:\\', true, 'list'), fv('E:\\Media', true, 'details')]
    expect(resolveFolderView('E:\\Media\\Movies', list)?.path).toBe('E:\\Media')
  })

  it('upsert replaces same path', () => {
    let list = [fv('E:\\A', false)]
    list = upsertFolderView(list, fv('E:\\A', true, 'list'))
    expect(list).toHaveLength(1)
    expect(list[0]!.recursive).toBe(true)
    expect(list[0]!.viewMode).toBe('list')
  })
})

describe('folderViewSummary', () => {
  it('labels the no-filename extra-large mode', () => {
    expect(folderViewSummary(fv('E:\\', false, 'extraLargeIconsNoName'))).toContain(
      'no filename'
    )
  })
})
