import { describe, expect, it } from 'vitest'
import {
  autoForceModifiers,
  eventMatchesTabDropShortcut,
  formatChord,
  isReservedAppChord,
  normalizeChordFromEvent,
  normalizeChordString,
  parseChord,
  validateTabDropShortcut
} from '../shared/tabDropShortcut'

describe('tabDropShortcut', () => {
  it('normalizes chords with stable modifier order', () => {
    expect(normalizeChordString('shift+ctrl+a')).toBe('Ctrl+Shift+A')
    expect(formatChord({ ctrl: true, shift: false, alt: false, key: '1' })).toBe('Ctrl+1')
  })

  it('builds chords from keyboard events', () => {
    expect(
      normalizeChordFromEvent({ key: '1', ctrlKey: true, shiftKey: false, altKey: false })
    ).toBe('Ctrl+1')
    expect(
      normalizeChordFromEvent({ key: 'Control', ctrlKey: true, shiftKey: false, altKey: false })
    ).toBeNull()
  })

  it('flags reserved app chords', () => {
    expect(isReservedAppChord('Ctrl+C')).toBe(true)
    expect(isReservedAppChord('ctrl+c')).toBe(true)
    expect(isReservedAppChord('Ctrl+1')).toBe(false)
  })

  it('rejects reserved and duplicate tab chords', () => {
    const tabs = [
      {
        id: 'a',
        title: 'Inbox',
        path: 'D:\\Inbox',
        dropShortcut: 'Ctrl+1'
      },
      {
        id: 'b',
        title: null,
        path: 'D:\\Out',
        dropShortcut: null
      }
    ]
    expect(validateTabDropShortcut('Ctrl+C', tabs, 'b').ok).toBe(false)
    expect(validateTabDropShortcut('Ctrl+1', tabs, 'b').ok).toBe(false)
    expect(validateTabDropShortcut('Ctrl+1', tabs, 'a')).toEqual({ ok: true, chord: 'Ctrl+1' })
    expect(validateTabDropShortcut('Ctrl+2', tabs, 'b')).toEqual({ ok: true, chord: 'Ctrl+2' })
  })

  it('matches bindings when required modifiers are held (extras allowed)', () => {
    expect(
      eventMatchesTabDropShortcut('1', {
        key: '1',
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true)
    expect(
      eventMatchesTabDropShortcut('1', {
        key: '1',
        ctrlKey: true,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true)
    expect(
      eventMatchesTabDropShortcut('Ctrl+1', {
        key: '1',
        ctrlKey: true,
        shiftKey: true,
        altKey: false
      })
    ).toBe(true)
    expect(
      eventMatchesTabDropShortcut('Ctrl+1', {
        key: '1',
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(false)
    // Must not steal reserved Ctrl+C via a key-only `C` binding.
    expect(
      eventMatchesTabDropShortcut('C', {
        key: 'c',
        ctrlKey: true,
        shiftKey: false,
        altKey: false
      })
    ).toBe(false)
  })

  it('treats Ctrl/Shift as auto force only when not part of the binding', () => {
    expect(
      autoForceModifiers('1', { ctrlKey: true, shiftKey: false })
    ).toEqual({ forceCopy: true, forceMove: false })
    expect(
      autoForceModifiers('Ctrl+1', { ctrlKey: true, shiftKey: false })
    ).toEqual({ forceCopy: false, forceMove: false })
    expect(
      autoForceModifiers('Ctrl+1', { ctrlKey: true, shiftKey: true })
    ).toEqual({ forceCopy: false, forceMove: true })
  })

  it('parses chord parts', () => {
    expect(parseChord('Ctrl+Shift+F5')).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      key: 'F5'
    })
  })
})
