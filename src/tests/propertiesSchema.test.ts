import { describe, expect, it } from 'vitest'
import { propertiesRequestSchema } from '@shared/schemas/properties'

describe('propertiesRequestSchema', () => {
  it('accepts absolute-looking paths', () => {
    expect(propertiesRequestSchema.parse({ path: 'C:\\' }).path).toBe('C:\\')
    expect(propertiesRequestSchema.parse({ path: 'D:\\folder' }).path).toBe('D:\\folder')
  })

  it('rejects empty path', () => {
    expect(() => propertiesRequestSchema.parse({ path: '' })).toThrow()
  })
})
