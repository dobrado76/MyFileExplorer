import { describe, expect, it } from 'vitest'
import { detectArchiveFormat } from '../main/preview/archiveFormat'

describe('detectArchiveFormat', () => {
  it('detects compound tar.gz / tgz before bare gz', () => {
    expect(detectArchiveFormat('C:\\a\\pack.tar.gz')).toBe('targz')
    expect(detectArchiveFormat('C:\\a\\pack.tgz')).toBe('targz')
    expect(detectArchiveFormat('C:\\a\\pack.gz')).toBeNull()
  })

  it('detects single-extension archives', () => {
    expect(detectArchiveFormat('C:\\a\\x.ZIP')).toBe('zip')
    expect(detectArchiveFormat('C:\\a\\x.7z')).toBe('7z')
    expect(detectArchiveFormat('C:\\a\\x.rar')).toBe('rar')
    expect(detectArchiveFormat('C:\\a\\x.tar')).toBe('tar')
    expect(detectArchiveFormat('C:\\a\\pack.unitypackage')).toBe('unitypackage')
    expect(detectArchiveFormat('C:\\a\\app.apk')).toBe('apk')
    expect(detectArchiveFormat('C:\\a\\Setup.MSI')).toBe('msi')
    expect(detectArchiveFormat('C:\\a\\disc.ISO')).toBe('iso')
    expect(detectArchiveFormat('C:\\a\\DamnSmallLinux.img')).toBe('img')
  })
})
