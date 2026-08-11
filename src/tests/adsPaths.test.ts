import { describe, expect, it } from 'vitest'
import {
  buildStreamPath,
  formatAdsColumnValue,
  formatAdsValuePreview,
  parseBackupStreamName,
  validateStreamName
} from '../shared/ads/paths'

describe('ADS path helpers (Trinet parity)', () => {
  it('builds path:stream:$DATA', () => {
    expect(buildStreamPath('C:\\a\\b.txt', 'Zone.Identifier')).toBe(
      'C:\\a\\b.txt:Zone.Identifier:$DATA'
    )
  })

  it('prefixes long paths with \\\\?\\', () => {
    const longFile = 'C:\\' + 'x'.repeat(240) + '.txt'
    const p = buildStreamPath(longFile, 'Meta')
    expect(p.startsWith('\\\\?\\')).toBe(true)
    expect(p.endsWith(':Meta:$DATA')).toBe(true)
  })

  it('parses BackupRead stream names', () => {
    expect(parseBackupStreamName(':Zone.Identifier:$DATA\0')).toBe('Zone.Identifier')
    expect(parseBackupStreamName('::$DATA\0')).toBeNull()
    expect(parseBackupStreamName('')).toBeNull()
  })

  it('rejects invalid stream name characters', () => {
    expect(() => validateStreamName('bad:name')).toThrow()
    expect(() => validateStreamName('ok_name')).not.toThrow()
  })

  it('formats column values', () => {
    expect(formatAdsColumnValue(['Zone.Identifier', 'Count'])).toBe(
      'Zone.Identifier, Count'
    )
    expect(formatAdsColumnValue([])).toBe('')
  })

  it('formats value preview for single-line vs multi-line', () => {
    expect(formatAdsValuePreview('hello')).toBe('hello')
    expect(formatAdsValuePreview('')).toBe('')
    expect(formatAdsValuePreview('a\nb')).toBe('[...]')
    expect(formatAdsValuePreview('a\r\nb')).toBe('[...]')
    expect(formatAdsValuePreview('bin\u0000ary')).toBe('[...]')
  })
})
