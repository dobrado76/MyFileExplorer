import { describe, it, expect } from 'vitest'
import { ok, err, errFromUnknown, AppError } from '../shared/result'

describe('Result envelope', () => {
  it('ok wraps values', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 })
  })

  it('err builds stable envelopes', () => {
    expect(err('not-found', 'missing')).toEqual({
      ok: false,
      error: { code: 'not-found', message: 'missing' }
    })
    expect(err('conflict', 'exists', 'rename it')).toEqual({
      ok: false,
      error: { code: 'conflict', message: 'exists', remediation: 'rename it' }
    })
  })

  it('maps node errno codes to stable app codes', () => {
    const cases: Array<[string, string]> = [
      ['ENOENT', 'not-found'],
      ['EACCES', 'not-allowed'],
      ['EPERM', 'not-allowed'],
      ['EEXIST', 'conflict'],
      ['ENOTEMPTY', 'conflict'],
      ['EBUSY', 'busy']
    ]
    for (const [errno, code] of cases) {
      const e = Object.assign(new Error(`boom ${errno}`), { code: errno })
      const envelope = errFromUnknown(e)
      expect(envelope.error.code).toBe(code)
    }
  })

  it('maps unknown errno to io', () => {
    const e = Object.assign(new Error('weird'), { code: 'ESOMETHING' })
    expect(errFromUnknown(e).error.code).toBe('io')
  })

  it('passes AppError through', () => {
    const envelope = errFromUnknown(new AppError('validation', 'bad path', 'use absolute'))
    expect(envelope.error).toEqual({
      code: 'validation',
      message: 'bad path',
      remediation: 'use absolute'
    })
  })

  it('passes AppError path through', () => {
    const envelope = errFromUnknown(
      new AppError('io', 'denied', undefined, 'C:\\conda-meta')
    )
    expect(envelope.error.path).toBe('C:\\conda-meta')
  })

  it('handles non-error throwables', () => {
    expect(errFromUnknown('oops').error.code).toBe('unknown')
  })
})
