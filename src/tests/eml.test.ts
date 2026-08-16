import { describe, expect, it } from 'vitest'
import {
  decodeEncodedWords,
  decodeQuotedPrintable,
  formatEmlHeaders,
  looksLikeEml,
  parseEml
} from '../shared/eml'

const SIMPLE = [
  'From: Alice <alice@example.com>',
  'To: Bob <bob@example.com>',
  'Subject: Hello',
  'Date: Sun, 16 Aug 2026 14:00:00 +1000',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=utf-8',
  '',
  'Hi Bob'
].join('\r\n')

describe('looksLikeEml', () => {
  it('requires a message header', () => {
    expect(looksLikeEml(SIMPLE)).toBe(true)
    expect(looksLikeEml('BEGIN:VCALENDAR')).toBe(false)
  })
})

describe('decodeEncodedWords', () => {
  it('decodes UTF-8 base64 and Q', () => {
    expect(decodeEncodedWords('=?UTF-8?B?SGVsbG8=?=')).toBe('Hello')
    expect(decodeEncodedWords('=?UTF-8?Q?Caf=C3=A9?=')).toBe('Café')
  })
})

describe('decodeQuotedPrintable', () => {
  it('decodes soft breaks and hex', () => {
    expect(decodeQuotedPrintable('caf=C3=A9=\n au lait')).toBe('café au lait')
  })
})

describe('parseEml', () => {
  it('reads a plain message', () => {
    const msg = parseEml(SIMPLE)
    expect(msg?.from).toBe('Alice <alice@example.com>')
    expect(msg?.to).toBe('Bob <bob@example.com>')
    expect(msg?.subject).toBe('Hello')
    expect(msg?.text).toBe('Hi Bob')
  })

  it('skips an mbox From line', () => {
    const msg = parseEml(`From MAILER-DAEMON Sun Aug 16 14:00:00 2026\n${SIMPLE}`)
    expect(msg?.subject).toBe('Hello')
  })

  it('picks plain + html from multipart/alternative and lists attachments', () => {
    const raw = [
      'From: a@b.test',
      'Subject: Mix',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="bnd"',
      '',
      '--bnd',
      'Content-Type: multipart/alternative; boundary="alt"',
      '',
      '--alt',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'plain body',
      '--alt',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>html body</p>',
      '--alt--',
      '--bnd',
      'Content-Type: application/pdf; name="report.pdf"',
      'Content-Disposition: attachment; filename="report.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0x',
      '--bnd--'
    ].join('\n')
    const msg = parseEml(raw)
    expect(msg?.text).toBe('plain body')
    expect(msg?.html).toBe('<p>html body</p>')
    expect(msg?.attachments).toEqual([
      expect.objectContaining({ filename: 'report.pdf', mime: 'application/pdf' })
    ])
    expect(formatEmlHeaders(msg!)).toContain('Attachments: report.pdf')
  })

  it('decodes encoded Subject', () => {
    const msg = parseEml('Subject: =?UTF-8?B?SGVsbG8=?=\nFrom: a@b.test\n\nHi')
    expect(msg?.subject).toBe('Hello')
  })
})
