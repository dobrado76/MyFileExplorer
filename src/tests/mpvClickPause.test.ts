import { describe, expect, it } from 'vitest'
import { mpvDipClickIsVideoToggle, mpvPointerInVideoToggleZone } from '../shared/mpvClickPause'
import { foldMpvPlaybackReplies, takeMpvIpcMessages } from '../shared/mpvIpc'

describe('mpvPointerInVideoToggleZone', () => {
  it('toggles anywhere when OSC is hidden', () => {
    expect(mpvPointerInVideoToggleZone(10, 400, false)).toBe(true)
    expect(mpvPointerInVideoToggleZone(390, 400, false)).toBe(true)
    expect(mpvPointerInVideoToggleZone(-1, 400, false)).toBe(false)
    expect(mpvPointerInVideoToggleZone(400, 400, false)).toBe(false)
  })

  it('skips the OSC bottom bar when it is shown', () => {
    expect(mpvPointerInVideoToggleZone(10, 400, true)).toBe(true)
    expect(mpvPointerInVideoToggleZone(390, 400, true)).toBe(false)
    expect(mpvPointerInVideoToggleZone(300, 400, true)).toBe(true)
  })
})

describe('mpvDipClickIsVideoToggle', () => {
  const host = { x: 200, y: 140, width: 800, height: 500 }

  it('toggles on the video picture', () => {
    expect(mpvDipClickIsVideoToggle({ x: 500, y: 300 }, host, true)).toBe(true)
  })

  it('ignores the window caption above the host', () => {
    expect(mpvDipClickIsVideoToggle({ x: 500, y: 20 }, host, false)).toBe(false)
  })

  it('ignores the in-page header beside/above the host', () => {
    expect(mpvDipClickIsVideoToggle({ x: 500, y: 100 }, host, false)).toBe(false)
  })

  it('skips the OSC bar', () => {
    expect(mpvDipClickIsVideoToggle({ x: 500, y: 620 }, host, true)).toBe(false)
  })
})

describe('takeMpvIpcMessages', () => {
  it('skips leading events and still finds time-pos / pause', () => {
    const into = { seconds: null as number | null, paused: null as boolean | null, haveTime: false, havePause: false }
    const { messages } = takeMpvIpcMessages(
      '{"event":"playback-restart"}\n' +
        '{"event":"property-change","name":"foo"}\n' +
        '{"error":"success","data":91.25,"request_id":1}\n' +
        '{"error":"success","data":false,"request_id":2}\n'
    )
    foldMpvPlaybackReplies(messages, into)
    expect(into.haveTime).toBe(true)
    expect(into.havePause).toBe(true)
    expect(into.seconds).toBe(91.25)
    expect(into.paused).toBe(false)
  })

  it('does not treat an event as a time-pos reply', () => {
    const into = { seconds: null as number | null, paused: null as boolean | null, haveTime: false, havePause: false }
    const { messages } = takeMpvIpcMessages('{"event":"start-file"}\n')
    foldMpvPlaybackReplies(messages, into)
    expect(into.haveTime).toBe(false)
    expect(into.seconds).toBeNull()
  })

  it('keeps a partial trailing line', () => {
    const { rest, messages } = takeMpvIpcMessages('{"event":"start-file"}\n{"error":"success"')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.event).toBe('start-file')
    expect(rest).toBe('{"error":"success"')
  })
})
