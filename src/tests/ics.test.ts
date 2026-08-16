import { describe, expect, it } from 'vitest'
import {
  formatIcsAgenda,
  icsDateRangeLabel,
  looksLikeIcs,
  parseIcs,
  parseIcsDate,
  unescapeIcs,
  unfoldIcsLines
} from '../shared/ics'

const SAMPLE = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'X-WR-CALNAME:Work',
  'X-WR-TIMEZONE:Australia/Sydney',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Australia/Sydney:20260816T100000',
  'DTEND;TZID=Australia/Sydney:20260816T103000',
  'SUMMARY:Team standup',
  'LOCATION:Room 4',
  'DESCRIPTION:Daily sync\\nBring notes',
  'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20260817',
  'DTEND;VALUE=DATE:20260818',
  'SUMMARY:Public holiday',
  'END:VEVENT',
  'BEGIN:VTODO',
  'SUMMARY:Buy milk',
  'DUE;VALUE=DATE:20260818',
  'END:VTODO',
  'END:VCALENDAR'
].join('\r\n')

describe('looksLikeIcs', () => {
  it('requires BEGIN:VCALENDAR', () => {
    expect(looksLikeIcs(SAMPLE)).toBe(true)
    expect(looksLikeIcs('SUMMARY:Nope')).toBe(false)
  })
})

describe('unfoldIcsLines', () => {
  it('joins folded lines', () => {
    const lines = unfoldIcsLines('SUMMARY:Hello\r\n  world\r\nLOCATION:A')
    expect(lines).toEqual(['SUMMARY:Hello world', 'LOCATION:A'])
  })
})

describe('unescapeIcs', () => {
  it('unescapes n comma semicolon backslash', () => {
    expect(unescapeIcs('a\\nb\\,c\\;d\\\\e')).toBe('a\nb,c;d\\e')
  })
})

describe('parseIcsDate', () => {
  it('formats date-only and UTC datetime', () => {
    expect(parseIcsDate('20260816', { VALUE: 'DATE' })?.display).toBe('16 Aug 2026')
    expect(parseIcsDate('20260816T140000Z')?.display).toBe('16 Aug 2026, 14:00 UTC')
    expect(parseIcsDate('20260816T090000', { TZID: 'Australia/Sydney' })?.display).toBe(
      '16 Aug 2026, 09:00 Australia/Sydney'
    )
  })
})

describe('parseIcs', () => {
  it('reads calendar name, events, todos, and duration-less all-day', () => {
    const cal = parseIcs(SAMPLE)
    expect(cal).not.toBeNull()
    expect(cal!.calendarName).toBe('Work')
    expect(cal!.timezone).toBe('Australia/Sydney')
    expect(cal!.method).toBe('REQUEST')
    expect(cal!.eventCount).toBe(2)
    expect(cal!.todoCount).toBe(1)
    expect(cal!.events[0]!.summary).toBe('Team standup')
    expect(cal!.events[0]!.location).toBe('Room 4')
    expect(cal!.events[0]!.start?.display).toContain('16 Aug 2026, 10:00')
    expect(cal!.events[1]!.summary).toBe('Public holiday')
    expect(cal!.events[1]!.start?.allDay).toBe(true)
    expect(cal!.events[1]!.end?.display).toBe('17 Aug 2026')
    expect(cal!.todos[0]!.summary).toBe('Buy milk')
  })

  it('computes end from DURATION', () => {
    const cal = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'DTSTART:20260816T100000Z',
        'DURATION:PT90M',
        'SUMMARY:Long meeting',
        'END:VEVENT',
        'END:VCALENDAR'
      ].join('\n')
    )
    expect(cal!.events[0]!.end?.display).toBe('16 Aug 2026, 11:30 UTC')
  })

  it('returns null when not a calendar', () => {
    expect(parseIcs('hello')).toBeNull()
  })
})

describe('formatIcsAgenda', () => {
  it('builds a readable agenda', () => {
    const text = formatIcsAgenda(parseIcs(SAMPLE)!)
    expect(text).toContain('Work')
    expect(text).toContain('REQUEST')
    expect(text).toContain('Team standup')
    expect(text).toContain('Room 4')
    expect(text).toContain('Repeats Weekly')
    expect(text).toContain('Public holiday')
    expect(text).toContain('all day')
    expect(text).toContain('To-do')
    expect(text).toContain('Buy milk')
    expect(icsDateRangeLabel(parseIcs(SAMPLE)!)).toContain('16 Aug 2026')
  })
})
