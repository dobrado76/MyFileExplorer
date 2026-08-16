import { describe, expect, it } from 'vitest'
import {
  ListingLru,
  LISTING_CACHE_MAX_ENTRIES,
  driveTypeForPath,
  isListingCacheEligible,
  listingCachePathIsUnder,
  listingCachePathKey
} from '../shared/listingCache'

describe('isListingCacheEligible', () => {
  it('allows UNC and mfe-remote', () => {
    expect(isListingCacheEligible('\\\\NAS\\Share\\photos')).toBe(true)
    expect(isListingCacheEligible('//nas/share')).toBe(true)
    expect(isListingCacheEligible('mfe-remote://abc-1/pub')).toBe(true)
  })

  it('allows mapped letters only when driveType is remote', () => {
    expect(isListingCacheEligible('Z:\\photos', { driveType: 'remote' })).toBe(true)
    expect(isListingCacheEligible('Z:\\photos', { driveType: 'fixed' })).toBe(false)
    expect(isListingCacheEligible('Z:\\photos')).toBe(false)
  })

  it('rejects local NTFS and empty', () => {
    expect(isListingCacheEligible('C:\\Users', { driveType: 'fixed' })).toBe(false)
    expect(isListingCacheEligible('D:\\', { driveType: 'removable' })).toBe(false)
    expect(isListingCacheEligible('')).toBe(false)
  })
})

describe('listingCachePathKey', () => {
  it('folds UNC case and trailing slash', () => {
    expect(listingCachePathKey('\\\\NAS\\Share\\')).toBe(listingCachePathKey('\\\\nas\\share'))
    expect(listingCachePathKey('//NAS/Share/a')).toBe(listingCachePathKey('\\\\nas\\share\\a'))
  })

  it('normalizes drive roots', () => {
    expect(listingCachePathKey('Z:')).toBe('z:\\')
    expect(listingCachePathKey('z:\\photos\\')).toBe('z:\\photos')
  })

  it('normalizes remote URIs', () => {
    expect(listingCachePathKey('mfe-remote://abc-1/pub/')).toBe(
      listingCachePathKey('mfe-remote://abc-1/pub')
    )
  })
})

describe('driveTypeForPath', () => {
  const drives = [
    { path: 'C:\\', driveType: 'fixed' as const },
    { path: 'Z:\\', driveType: 'remote' as const }
  ]

  it('matches the volume letter', () => {
    expect(driveTypeForPath('Z:\\photos\\2024', drives)).toBe('remote')
    expect(driveTypeForPath('c:\\Users', drives)).toBe('fixed')
    expect(driveTypeForPath('\\\\NAS\\Share', drives)).toBeNull()
  })
})

describe('listingCachePathIsUnder', () => {
  it('matches children not sibling prefixes', () => {
    expect(listingCachePathIsUnder('\\\\nas\\share\\a', '\\\\nas\\share')).toBe(true)
    expect(listingCachePathIsUnder('z:\\photos\\2024', 'z:\\photos')).toBe(true)
    expect(listingCachePathIsUnder('z:\\photo', 'z:\\photos')).toBe(false)
    expect(
      listingCachePathIsUnder('mfe-remote://id/a/b', listingCachePathKey('mfe-remote://id/a'))
    ).toBe(true)
  })
})

describe('ListingLru', () => {
  it('evicts the oldest folder when over cap', () => {
    const lru = new ListingLru<string>(2, 10)
    lru.set('\\\\n\\a', ['1'])
    lru.set('\\\\n\\b', ['2'])
    lru.set('\\\\n\\c', ['3'])
    expect(lru.get('\\\\n\\a')).toBeUndefined()
    expect(lru.get('\\\\n\\b')).toEqual(['2'])
    expect(lru.get('\\\\n\\c')).toEqual(['3'])
  })

  it('get refreshes recency so the next evict skips the hit', () => {
    const lru = new ListingLru<string>(2, 10)
    lru.set('\\\\n\\a', ['1'])
    lru.set('\\\\n\\b', ['2'])
    expect(lru.get('\\\\n\\a')).toEqual(['1'])
    lru.set('\\\\n\\c', ['3'])
    expect(lru.get('\\\\n\\a')).toEqual(['1'])
    expect(lru.get('\\\\n\\b')).toBeUndefined()
  })

  it('skips huge listings and drops a prior entry for that path', () => {
    const lru = new ListingLru<number>(4, 3)
    lru.set('\\\\n\\a', [1, 2])
    expect(lru.set('\\\\n\\a', [1, 2, 3, 4])).toBe(false)
    expect(lru.get('\\\\n\\a')).toBeUndefined()
    expect(lru.set('\\\\n\\b', new Array(LISTING_CACHE_MAX_ENTRIES + 1).fill(0))).toBe(false)
  })

  it('invalidate drops the folder and descendants', () => {
    const lru = new ListingLru<string>(8, 10)
    lru.set('\\\\nas\\share', ['root'])
    lru.set('\\\\nas\\share\\photos', ['p'])
    lru.set('\\\\nas\\other', ['o'])
    lru.invalidate('\\\\nas\\share')
    expect(lru.get('\\\\nas\\share')).toBeUndefined()
    expect(lru.get('\\\\nas\\share\\photos')).toBeUndefined()
    expect(lru.get('\\\\nas\\other')).toEqual(['o'])
  })
})
