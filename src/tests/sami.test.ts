import { describe, expect, it } from 'vitest'
import { decodeSamiBuffer, sniffSamiCharset } from '../main/preview/sami'

/** EUC-KR bytes for 니키입니다 (from a typical KR SAMI). */
const NIKI = Buffer.from('b4cfc5b0c0d4b4cfb4d9', 'hex')

describe('sniffSamiCharset', () => {
  it('reads charset= and lang:kr-KR / KRCC', () => {
    expect(sniffSamiCharset(Buffer.from('<meta charset="euc-kr">', 'ascii'))).toBe('euc-kr')
    expect(sniffSamiCharset(Buffer.from('.KRCC { lang:kr-KR; }', 'ascii'))).toBe('euc-kr')
    expect(sniffSamiCharset(Buffer.from('<P Class=KRCC>', 'ascii'))).toBe('euc-kr')
  })
})

describe('decodeSamiBuffer', () => {
  it('decodes EUC-KR Korean (not as UTF-8 mojibake)', () => {
    const header = Buffer.from('<SAMI>\r\n<STYLE>\r\n.KRCC { lang:kr-KR; }\r\n', 'ascii')
    const buf = Buffer.concat([header, Buffer.from('<i>', 'ascii'), NIKI, Buffer.from('</i>', 'ascii')])
    const { text, encoding } = decodeSamiBuffer(buf)
    expect(encoding).toBe('EUC-KR')
    expect(text).toContain('니키입니다')
    expect(text).not.toContain('\uFFFD')
  })

  it('keeps UTF-8 SAMI as UTF-8', () => {
    const buf = Buffer.from('<SAMI><BODY><SYNC Start=1><P>Hello café</P></BODY></SAMI>', 'utf8')
    const { text, encoding } = decodeSamiBuffer(buf)
    expect(encoding).toBe('UTF-8')
    expect(text).toContain('Hello café')
  })
})
