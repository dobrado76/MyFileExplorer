import { describe, expect, it } from 'vitest'
import {
  formatRemoteLocation,
  normalizeRemotePosixPath,
  parseRemoteLocation,
  remoteJoin,
  remoteParentPath
} from '../shared/remotePaths'

describe('remotePaths', () => {
  it('parses and formats round-trip', () => {
    const uri = formatRemoteLocation('abc-1', '/pub/demo')
    expect(uri).toBe('mfe-remote://abc-1/pub/demo')
    expect(parseRemoteLocation(uri)).toEqual({
      connectionId: 'abc-1',
      remotePath: '/pub/demo'
    })
  })

  it('rejects climb above root', () => {
    expect(normalizeRemotePosixPath('/a/../..')).toBeNull()
    expect(normalizeRemotePosixPath('/a/../b')).toBe('/b')
  })

  it('joins and parents', () => {
    expect(remoteJoin('/', 'pub')).toBe('/pub')
    expect(remoteJoin('/pub', 'x')).toBe('/pub/x')
    expect(remoteParentPath('/pub/x')).toBe('/pub')
    expect(remoteParentPath('/')).toBeNull()
  })
})
