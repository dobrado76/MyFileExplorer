import { pathKey, samePath } from './paths'
import type { PropertiesKind, PropertiesModel } from './schemas/properties'

/** Build WFE-style type label for a multi-item Properties sheet. */
export function combinedTypeLabel(kinds: PropertiesKind[]): string {
  const usable = kinds.filter((k) => k !== 'missing' && k !== 'multi')
  if (usable.length === 0) return 'Multiple Types'
  const dirs = usable.filter((k) => k === 'dir' || k === 'drive').length
  const files = usable.filter((k) => k === 'file' || k === 'symlink').length
  if (dirs > 0 && files > 0) return 'Multiple Types'
  if (dirs === usable.length) return dirs === 1 ? 'File folder' : 'File folders'
  if (files === usable.length) return files === 1 ? 'File' : 'Files'
  return 'Multiple Types'
}

/** Common parent location, or null when items live under different parents. */
export function combinedLocation(locations: (string | null)[]): string | null {
  const known = locations.filter((l): l is string => !!l)
  if (known.length === 0) return null
  const first = known[0]!
  return known.every((l) => samePath(l, first)) ? first : null
}

/**
 * Aggregate single-item property models into one multi-select sheet
 * (Size/Contains completed later via measurePaths).
 */
export function combinePropertiesModels(models: PropertiesModel[]): PropertiesModel {
  if (models.length === 0) {
    return {
      path: '',
      name: '0 items',
      location: null,
      kind: 'multi',
      typeLabel: 'Multiple Types',
      sizeBytes: 0,
      contains: null,
      canMeasure: false,
      measurePaths: [],
      paths: [],
      createdMs: null,
      modifiedMs: null,
      accessedMs: null,
      attributes: [],
      drive: null,
      linkTarget: null
    }
  }
  if (models.length === 1) return models[0]!

  const paths = models.map((m) => m.path)
  // Drives: capacity UI only on single-drive sheets; combined ignores drive pie.
  const dirsForMeasure = models.filter((m) => m.kind === 'dir').map((m) => m.path)
  const fileBytes = models
    .filter((m) => m.kind === 'file' || (m.kind === 'symlink' && m.sizeBytes != null))
    .reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0)

  return {
    path: paths[0]!,
    name: `${paths.length} items`,
    location: combinedLocation(models.map((m) => m.location)),
    kind: 'multi',
    typeLabel: combinedTypeLabel(models.map((m) => m.kind)),
    sizeBytes: fileBytes,
    contains: null,
    canMeasure: dirsForMeasure.length > 0,
    measurePaths: dirsForMeasure,
    paths,
    createdMs: null,
    modifiedMs: null,
    accessedMs: null,
    attributes: [],
    drive: null,
    linkTarget: null
  }
}

/** Stable key for focusing an existing combined Properties window. */
export function combinedPropertiesWindowKey(paths: string[]): string {
  return `multi:${[...paths].map((p) => pathKey(p)).sort().join('|')}`
}
