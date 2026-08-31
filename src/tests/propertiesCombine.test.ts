import { describe, expect, it } from 'vitest'
import {
  combinedLocation,
  combinedTypeLabel,
  combinePropertiesModels
} from '../shared/propertiesCombine'
import type { PropertiesModel } from '../shared/schemas/properties'

function base(partial: Partial<PropertiesModel> & Pick<PropertiesModel, 'path' | 'kind'>): PropertiesModel {
  return {
    name: 'x',
    location: 'C:\\parent',
    typeLabel: 'File',
    sizeBytes: null,
    contains: null,
    canMeasure: false,
    createdMs: null,
    modifiedMs: null,
    accessedMs: null,
    attributes: [],
    drive: null,
    linkTarget: null,
    ...partial
  }
}

describe('propertiesCombine', () => {
  it('labels mixed selection as Multiple Types', () => {
    expect(combinedTypeLabel(['file', 'dir'])).toBe('Multiple Types')
    expect(combinedTypeLabel(['dir', 'dir'])).toBe('File folders')
    expect(combinedTypeLabel(['file', 'file'])).toBe('Files')
  })

  it('returns common location only when all match', () => {
    expect(combinedLocation(['C:\\a', 'C:\\a'])).toBe('C:\\a')
    expect(combinedLocation(['C:\\a', 'C:\\b'])).toBeNull()
  })

  it('aggregates multi models', () => {
    const m = combinePropertiesModels([
      base({ path: 'C:\\a\\f1.txt', kind: 'file', sizeBytes: 10, name: 'f1.txt' }),
      base({ path: 'C:\\a\\d1', kind: 'dir', canMeasure: true, name: 'd1' })
    ])
    expect(m.kind).toBe('multi')
    expect(m.name).toBe('2 items')
    expect(m.typeLabel).toBe('Multiple Types')
    expect(m.sizeBytes).toBe(10)
    expect(m.measurePaths).toEqual(['C:\\a\\d1'])
    expect(m.canMeasure).toBe(true)
    expect(m.attributes).toEqual([])
  })
})
