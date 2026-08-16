/** iCalendar (RFC 5545) — unfold, parse, format an agenda. Not a full calendar engine. */

export const ICS_AGENDA_MAX_EVENTS = 100
export const ICS_AGENDA_MAX_TODOS = 40

export type IcsDate = {
  raw: string
  display: string
  sortKey: string
  allDay?: boolean
  tzid?: string
  utc?: boolean
}

export type IcsEvent = {
  summary: string
  start?: IcsDate
  end?: IcsDate
  location?: string
  description?: string
  status?: string
  rrule?: string
}

export type IcsTodo = {
  summary: string
  due?: IcsDate
  status?: string
}

export type IcsCalendar = {
  calendarName?: string
  timezone?: string
  method?: string
  events: IcsEvent[]
  todos: IcsTodo[]
  eventCount: number
  todoCount: number
  truncated?: boolean
}

type IcsProp = { name: string; params: Record<string, string>; value: string }

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
]

export function looksLikeIcs(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR\b/im.test(text)
}

export function unfoldIcsLines(text: string): string[] {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const lines: string[] = []
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
  }
  return lines
}

export function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function parseContentLine(line: string): IcsProp | null {
  let colon = -1
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQuote = !inQuote
    else if (c === ':' && !inQuote) {
      colon = i
      break
    }
  }
  if (colon < 0) return null
  const left = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const segs: string[] = []
  let cur = ''
  inQuote = false
  for (const c of left) {
    if (c === '"') {
      inQuote = !inQuote
      cur += c
    } else if (c === ';' && !inQuote) {
      segs.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  segs.push(cur)
  const name = (segs[0] ?? '').trim().toUpperCase()
  if (!name) return null
  const params: Record<string, string> = {}
  for (const seg of segs.slice(1)) {
    const eq = seg.indexOf('=')
    if (eq < 0) continue
    const key = seg.slice(0, eq).trim().toUpperCase()
    let val = seg.slice(eq + 1).trim()
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1)
    }
    if (key) params[key] = val
  }
  return { name, params, value }
}

export function parseIcsDate(value: string, params: Record<string, string> = {}): IcsDate | undefined {
  const raw = value.trim()
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/i.exec(raw)
  if (!m) return undefined
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const hh = m[4] != null ? Number(m[4]) : null
  const mm = m[5] != null ? Number(m[5]) : null
  const allDay = params.VALUE === 'DATE' || hh == null
  const utc = m[7] != null
  const tzid = params.TZID
  const mon = MONTHS[mo - 1] ?? String(mo)
  const day = `${d} ${mon} ${y}`
  let display = day
  if (!allDay && hh != null && mm != null) {
    display = `${day}, ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    if (utc) display += ' UTC'
    else if (tzid) display += ` ${tzid}`
  }
  const sortKey = raw.replace(/Z$/i, '').padEnd(15, '0')
  return { raw, display, sortKey, allDay, tzid, utc }
}

function addIcsDuration(start: IcsDate, duration: string): IcsDate | undefined {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(duration.trim())
  if (!m) return undefined
  const weeks = Number(m[1] ?? 0)
  const days = Number(m[2] ?? 0) + weeks * 7
  const hours = Number(m[3] ?? 0)
  const mins = Number(m[4] ?? 0)
  const dateM = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(start.raw)
  if (!dateM) return undefined
  const dt = new Date(
    Date.UTC(
      Number(dateM[1]),
      Number(dateM[2]) - 1,
      Number(dateM[3]) + days,
      Number(dateM[4] ?? 0) + hours,
      Number(dateM[5] ?? 0) + mins,
      Number(dateM[6] ?? 0)
    )
  )
  if (Number.isNaN(dt.getTime())) return undefined
  const y = dt.getUTCFullYear()
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  if (start.allDay) {
    return parseIcsDate(`${y}${mo}${d}`, { VALUE: 'DATE' })
  }
  const hh = String(dt.getUTCHours()).padStart(2, '0')
  const mm = String(dt.getUTCMinutes()).padStart(2, '0')
  const ss = String(dt.getUTCSeconds()).padStart(2, '0')
  const z = start.utc ? 'Z' : ''
  const params: Record<string, string> = {}
  if (start.tzid) params.TZID = start.tzid
  return parseIcsDate(`${y}${mo}${d}T${hh}${mm}${ss}${z}`, params)
}

function rruleLabel(rrule: string): string {
  const freq = /FREQ=([A-Z]+)/i.exec(rrule)?.[1]?.toUpperCase()
  const interval = Number(/INTERVAL=(\d+)/i.exec(rrule)?.[1] ?? 1)
  const count = /COUNT=(\d+)/i.exec(rrule)?.[1]
  const until = /UNTIL=([^;]+)/i.exec(rrule)?.[1]
  const base =
    freq === 'DAILY'
      ? interval > 1
        ? `Every ${interval} days`
        : 'Daily'
      : freq === 'WEEKLY'
        ? interval > 1
          ? `Every ${interval} weeks`
          : 'Weekly'
        : freq === 'MONTHLY'
          ? interval > 1
            ? `Every ${interval} months`
            : 'Monthly'
          : freq === 'YEARLY'
            ? interval > 1
              ? `Every ${interval} years`
              : 'Yearly'
            : rrule
  const extra: string[] = []
  if (count) extra.push(`${count} times`)
  if (until) {
    const u = parseIcsDate(until)
    extra.push(u ? `until ${u.display}` : `until ${until}`)
  }
  return extra.length ? `${base} (${extra.join(', ')})` : base
}

/** All-day DTEND is exclusive (next day). Show the last included day. */
function exclusiveAllDayEnd(end: IcsDate, start: IcsDate): IcsDate {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(end.raw)
  if (!m) return end
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1))
  if (Number.isNaN(dt.getTime())) return end
  const y = dt.getUTCFullYear()
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  const adj = parseIcsDate(`${y}${mo}${d}`, { VALUE: 'DATE' })
  if (!adj) return end
  if (adj.sortKey < start.sortKey) return start
  return adj
}

function firstLine(text: string, max = 160): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= max) return line
  return `${line.slice(0, max - 1)}…`
}

export function parseIcs(text: string): IcsCalendar | null {
  if (!looksLikeIcs(text)) return null
  const lines = unfoldIcsLines(text)
  const events: IcsEvent[] = []
  const todos: IcsTodo[] = []
  let eventCount = 0
  let todoCount = 0
  let truncated = false
  let calendarName: string | undefined
  let timezone: string | undefined
  let method: string | undefined

  const stack: string[] = []
  let cur: Record<string, IcsProp> | null = null
  let curKind: 'VEVENT' | 'VTODO' | null = null

  const flush = (): void => {
    if (!cur || !curKind) return
    const summary = cur.SUMMARY ? unescapeIcs(cur.SUMMARY.value).trim() : '(No title)'
    const start = cur.DTSTART
      ? parseIcsDate(cur.DTSTART.value, cur.DTSTART.params)
      : undefined
    if (curKind === 'VEVENT') {
      eventCount += 1
      if (events.length >= ICS_AGENDA_MAX_EVENTS) {
        truncated = true
        return
      }
      let end = cur.DTEND ? parseIcsDate(cur.DTEND.value, cur.DTEND.params) : undefined
      if (!end && start && cur.DURATION) {
        end = addIcsDuration(start, cur.DURATION.value)
      }
      if (end?.allDay && start?.allDay) {
        end = exclusiveAllDayEnd(end, start)
      }
      events.push({
        summary,
        start,
        end,
        location: cur.LOCATION ? firstLine(unescapeIcs(cur.LOCATION.value)) : undefined,
        description: cur.DESCRIPTION ? firstLine(unescapeIcs(cur.DESCRIPTION.value)) : undefined,
        status: cur.STATUS?.value.trim(),
        rrule: cur.RRULE?.value.trim()
      })
      return
    }
    todoCount += 1
    if (todos.length >= ICS_AGENDA_MAX_TODOS) {
      truncated = true
      return
    }
    todos.push({
      summary,
      due: cur.DUE ? parseIcsDate(cur.DUE.value, cur.DUE.params) : undefined,
      status: cur.STATUS?.value.trim()
    })
  }

  for (const line of lines) {
    if (!line.trim()) continue
    const prop = parseContentLine(line)
    if (!prop) continue
    if (prop.name === 'BEGIN') {
      const kind = prop.value.trim().toUpperCase()
      stack.push(kind)
      if (kind === 'VEVENT' || kind === 'VTODO') {
        cur = {}
        curKind = kind
      }
      continue
    }
    if (prop.name === 'END') {
      const kind = prop.value.trim().toUpperCase()
      if (kind === 'VEVENT' || kind === 'VTODO') flush()
      cur = null
      curKind = null
      if (stack.length) stack.pop()
      continue
    }
    const top = stack[stack.length - 1]
    if (cur && (top === 'VEVENT' || top === 'VTODO')) {
      if (!cur[prop.name]) cur[prop.name] = prop
      continue
    }
    if (top === 'VCALENDAR') {
      if (prop.name === 'X-WR-CALNAME' || prop.name === 'NAME') {
        calendarName = unescapeIcs(prop.value).trim()
      } else if (prop.name === 'X-WR-TIMEZONE' || prop.name === 'TZID') {
        timezone = prop.value.trim()
      } else if (prop.name === 'METHOD') {
        method = prop.value.trim().toUpperCase()
      }
    }
  }
  if (cur) flush()

  events.sort((a, b) => (a.start?.sortKey ?? '\uFFEF').localeCompare(b.start?.sortKey ?? '\uFFEF'))
  todos.sort((a, b) => (a.due?.sortKey ?? '\uFFEF').localeCompare(b.due?.sortKey ?? '\uFFEF'))

  return {
    calendarName,
    timezone,
    method,
    events,
    todos,
    eventCount,
    todoCount,
    truncated
  }
}

function whenLine(ev: IcsEvent): string {
  if (!ev.start) return 'No date'
  if (!ev.end || ev.end.display === ev.start.display) {
    return ev.start.allDay ? `${ev.start.display} (all day)` : ev.start.display
  }
  if (ev.start.allDay && ev.end.allDay) {
    return `${ev.start.display} – ${ev.end.display}`
  }
  const sameDay = ev.start.raw.slice(0, 8) === ev.end.raw.slice(0, 8)
  if (sameDay && !ev.start.allDay && !ev.end.allDay) {
    const endTime = ev.end.display.includes(', ')
      ? ev.end.display.slice(ev.end.display.indexOf(', ') + 2)
      : ev.end.display
    return `${ev.start.display} – ${endTime}`
  }
  return `${ev.start.display} – ${ev.end.display}`
}

export function formatIcsAgenda(cal: IcsCalendar): string {
  const lines: string[] = []
  if (cal.calendarName) lines.push(cal.calendarName)
  const meta: string[] = []
  if (cal.method && cal.method !== 'PUBLISH') meta.push(cal.method)
  if (cal.timezone) meta.push(cal.timezone)
  const counts: string[] = []
  if (cal.eventCount) counts.push(`${cal.eventCount} event${cal.eventCount === 1 ? '' : 's'}`)
  if (cal.todoCount) counts.push(`${cal.todoCount} to-do${cal.todoCount === 1 ? '' : 's'}`)
  if (counts.length) meta.push(counts.join(', '))
  if (meta.length) lines.push(meta.join(' · '))
  if (lines.length) lines.push('')

  if (cal.events.length === 0 && cal.todos.length === 0) {
    lines.push('No events')
    return lines.join('\n').trimEnd()
  }

  for (const ev of cal.events) {
    lines.push(whenLine(ev))
    lines.push(ev.summary)
    const bits: string[] = []
    if (ev.location) bits.push(ev.location)
    if (ev.status && ev.status.toUpperCase() !== 'CONFIRMED') bits.push(ev.status)
    if (ev.rrule) bits.push(`Repeats ${rruleLabel(ev.rrule)}`)
    if (bits.length) lines.push(bits.join(' · '))
    if (ev.description) lines.push(ev.description)
    lines.push('')
  }

  if (cal.todos.length) {
    lines.push('To-do')
    for (const t of cal.todos) {
      const due = t.due ? ` · due ${t.due.display}` : ''
      const st = t.status && t.status.toUpperCase() !== 'NEEDS-ACTION' ? ` · ${t.status}` : ''
      lines.push(`${t.summary}${due}${st}`)
    }
    lines.push('')
  }

  if (cal.truncated) {
    const moreEvents = Math.max(0, cal.eventCount - cal.events.length)
    const moreTodos = Math.max(0, cal.todoCount - cal.todos.length)
    const more = [moreEvents && `${moreEvents} more events`, moreTodos && `${moreTodos} more to-dos`]
      .filter(Boolean)
      .join(', ')
    if (more) lines.push(`…and ${more}`)
  }

  return lines.join('\n').replace(/\n+$/, '')
}

export function icsDateRangeLabel(cal: IcsCalendar): string | undefined {
  const dates = cal.events.map((e) => e.start).filter((d): d is IcsDate => !!d)
  if (dates.length === 0) return undefined
  const first = dates[0]!
  const last = dates[dates.length - 1]!
  if (first.display === last.display) return first.allDay ? `${first.display} (all day)` : first.display
  return `${first.display} – ${last.display}`
}
