import { describe, expect, it } from 'vitest'
import { parseOpenArgs, parseProtocolUrl, userArgv } from '../main/openTarget'

describe('parseProtocolUrl', () => {
  it('parses reveal URLs', () => {
    const req = parseProtocolUrl('mfe://reveal?path=D%3A%5CArts%5Cshot.png')
    expect(req).toEqual({ path: 'D:\\Arts\\shot.png', reveal: true })
  })

  it('parses open URLs', () => {
    const req = parseProtocolUrl('mfe://open?path=D%3A%5CArts')
    expect(req).toEqual({ path: 'D:\\Arts', reveal: false })
  })
})

describe('parseOpenArgs', () => {
  it('treats a bare absolute path as reveal', () => {
    expect(parseOpenArgs(['electron.exe', 'D:\\folder\\file.txt'])).toEqual([
      { path: 'D:\\folder\\file.txt', reveal: true }
    ])
  })

  it('handles --reveal and --open flags', () => {
    expect(parseOpenArgs(['app', '--reveal', 'C:\\a\\b.txt', '--open', 'C:\\a'])).toEqual([
      { path: 'C:\\a\\b.txt', reveal: true },
      { path: 'C:\\a', reveal: false }
    ])
  })

  it('accepts protocol URLs in argv', () => {
    expect(parseOpenArgs(['app', 'mfe://reveal?path=C%3A%5Cx'])).toEqual([
      { path: 'C:\\x', reveal: true }
    ])
  })
})

describe('userArgv', () => {
  it('drops electron runtime noise', () => {
    const cleaned = userArgv([
      'C:\\electron.exe',
      '.',
      '--reveal',
      'D:\\x',
      '--inspect=9229'
    ])
    expect(cleaned).toEqual(['--reveal', 'D:\\x'])
  })

  it('drops the elevated USN helper argv', () => {
    expect(
      userArgv([
        'C:\\electron.exe',
        '--usn-recent',
        'C:',
        'C:\\Users\\me\\AppData\\Roaming\\MyFileExplorer\\scratch\\usn-recent-C.json'
      ])
    ).toEqual([])
  })
})
