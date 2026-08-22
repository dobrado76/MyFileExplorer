import { describe, expect, it } from 'vitest'
import { classifyEmptyRecycleHresult } from '../main/fs/recycle'

describe('classifyEmptyRecycleHresult', () => {
  it('treats S_OK / S_FALSE / E_UNEXPECTED as success', () => {
    expect(classifyEmptyRecycleHresult(0)).toBe('ok')
    expect(classifyEmptyRecycleHresult(1)).toBe('ok')
    expect(classifyEmptyRecycleHresult(0x8000ffff | 0)).toBe('ok')
  })

  it('treats ERROR_CANCELLED as cancelled', () => {
    expect(classifyEmptyRecycleHresult(0x800704c7 | 0)).toBe('cancelled')
    expect(classifyEmptyRecycleHresult(-2147023673)).toBe('cancelled')
  })

  it('treats other failure HRESULTs as failed', () => {
    expect(classifyEmptyRecycleHresult(0x80004005 | 0)).toBe('failed')
  })
})
