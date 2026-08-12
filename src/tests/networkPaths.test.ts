import { describe, expect, it } from 'vitest'
import {
  driveTypeFromWin32,
  DRIVE_FIXED,
  DRIVE_REMOTE,
  DRIVE_REMOVABLE,
  collapseHostIpAliases,
  displayHostLabel,
  filterOutLocalNetworkHosts,
  hostUnc,
  isHiddenNetworkShare,
  isIpv4Literal,
  isNetworkHostUnc,
  isNetworkShareUnc,
  networkHostIdentityKeys,
  normalizeServerName,
  parseUnc,
  preferHostLabel,
  shareUnc
} from '../shared/networkPaths'

describe('driveTypeFromWin32', () => {
  it('maps Win32 constants', () => {
    expect(driveTypeFromWin32(DRIVE_FIXED)).toBe('fixed')
    expect(driveTypeFromWin32(DRIVE_REMOTE)).toBe('remote')
    expect(driveTypeFromWin32(DRIVE_REMOVABLE)).toBe('removable')
    expect(driveTypeFromWin32(0)).toBe('unknown')
  })
})

describe('UNC helpers', () => {
  it('normalizes server names', () => {
    expect(normalizeServerName('\\\\NAS\\Share')).toBe('NAS')
    expect(normalizeServerName('pc.local.')).toBe('pc.local')
  })

  it('builds host and share UNC', () => {
    expect(hostUnc('NAS')).toBe('\\\\NAS')
    expect(shareUnc('NAS', 'Media')).toBe('\\\\NAS\\Media')
  })

  it('hides $ admin shares', () => {
    expect(isHiddenNetworkShare('IPC$')).toBe(true)
    expect(isHiddenNetworkShare('C$')).toBe(true)
    expect(isHiddenNetworkShare('Media')).toBe(false)
  })

  it('parses UNC kinds', () => {
    expect(parseUnc('\\\\server')?.kind).toBe('host')
    expect(parseUnc('\\\\server\\share')?.kind).toBe('share')
    expect(parseUnc('\\\\server\\share\\folder')?.kind).toBe('path')
    expect(isNetworkHostUnc('\\\\box')).toBe(true)
    expect(isNetworkShareUnc('\\\\box\\docs')).toBe(true)
    expect(isNetworkShareUnc('\\\\box\\docs\\a')).toBe(false)
  })
})

describe('host display / alias collapse', () => {
  it('uppercases simple lowercase NetBIOS-style labels', () => {
    expect(displayHostLabel('newonyx')).toBe('NEWONYX')
    expect(displayHostLabel('NEWONYX')).toBe('NEWONYX')
    expect(displayHostLabel('192.168.0.152')).toBe('192.168.0.152')
    expect(isIpv4Literal('192.168.0.152')).toBe(true)
  })

  it('prefers hostname over IP and richer casing', () => {
    expect(preferHostLabel('192.168.0.152', 'newonyx')).toBe('newonyx')
    expect(preferHostLabel('newonyx', 'NEWONYX')).toBe('NEWONYX')
  })

  it('collapses IP when hostname alias is known', () => {
    const hosts = [
      { name: '192.168.0.152', unc: '\\\\192.168.0.152' },
      { name: 'newonyx', unc: '\\\\newonyx' }
    ]
    const map = new Map([['192.168.0.152', 'NEWONYX']])
    const out = collapseHostIpAliases(hosts, map)
    expect(out).toEqual([{ name: 'NEWONYX', unc: '\\\\NEWONYX' }])
  })

  it('filters out the local computer from Network hosts', () => {
    expect(networkHostIdentityKeys('PC.lan')).toEqual(expect.arrayContaining(['pc.lan', 'pc']))
    const hosts = [
      { name: 'PC', unc: '\\\\PC' },
      { name: 'NAS', unc: '\\\\NAS' },
      { name: 'pc.home.arpa', unc: '\\\\pc.home.arpa' }
    ]
    expect(filterOutLocalNetworkHosts(hosts, ['PC'])).toEqual([{ name: 'NAS', unc: '\\\\NAS' }])
  })
})
