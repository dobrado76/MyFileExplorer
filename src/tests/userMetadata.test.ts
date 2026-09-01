import { describe, expect, it } from 'vitest'
import { parseEverythingQuery } from '../main/search/everythingQuery'
import { metaRecordMatches } from '../shared/metaSearch'
import {
  allUserMetadataFields,
  newUserMetadataFieldId,
  newUserMetadataOptionId,
  newUserMetadataSetId,
  type UserMetadataDoc,
  type UserMetadataField
} from '../shared/schemas/userMetadata'
import { compileWholeValuePattern, testWholeValueSync } from '../shared/userMetadataValidate'
import { buildSearchQuery, defaultPowerSearchState } from '../shared/searchBuilder'
import { defaultSettings, settingsSchema } from '../shared/schemas/settings'
import { buildSettingsExportDocument, parseSettingsImport } from '../shared/schemas/settingsExport'

const reviewOpt = {
  id: newUserMetadataOptionId(),
  key: 'awaiting_review',
  label: 'Awaiting review'
}

const fields: UserMetadataField[] = [
  {
    id: newUserMetadataFieldId(),
    key: 'review_state',
    name: 'Review state',
    type: 'choice',
    choices: [reviewOpt],
    showAsColumn: true
  },
  {
    id: newUserMetadataFieldId(),
    key: 'rating',
    name: 'Rating',
    type: 'number',
    showAsColumn: false
  },
  {
    id: newUserMetadataFieldId(),
    key: 'email',
    name: 'Email',
    type: 'text',
    text: {
      validation: {
        pattern: '[^\\s@]+@[^\\s@]+\\.[^\\s@]+',
        flags: 'i',
        message: 'Enter a valid email address.'
      }
    },
    showAsColumn: false
  }
]

const setId = newUserMetadataSetId()

describe('user metadata validation', () => {
  it('rejects nested-quantifier patterns', () => {
    const r = compileWholeValuePattern({ pattern: '(a+)+$', flags: '' })
    expect(r.ok).toBe(false)
  })

  it('whole-value email match', () => {
    const v = fields[2]!.text!.validation!
    expect(testWholeValueSync('user@example.com', v).ok).toBe(true)
    expect(testWholeValueSync('garbage user@example.com garbage', v).ok).toBe(false)
    expect(testWholeValueSync('', v).ok).toBe(true)
  })
})

describe('meta search parse + match', () => {
  it('parses meta.<key>: and hasmeta:', () => {
    const q = parseEverythingQuery('meta.review_state:awaiting_review hasmeta:', {
      userMetadataFields: fields
    })
    expect(q.hasMeta).toBe(true)
    expect(q.metaClauses.length).toBe(1)
    expect(q.metaClauses[0]!.fieldId).toBe(fields[0]!.id)
    expect(q.metaClauses[0]!.value).toBe(reviewOpt.id)
  })

  it('parses number compare', () => {
    const q = parseEverythingQuery('meta.rating:>=4', { userMetadataFields: fields })
    expect(q.metaClauses[0]?.mode).toBe('cmp')
    expect(q.metaClauses[0]?.cmpOp).toBe('>=')
    expect(q.metaClauses[0]?.cmpNum).toBe(4)
  })

  it('ORs duplicate keys across sets', () => {
    const optA = { id: newUserMetadataOptionId(), key: 'approved', label: 'Approved' }
    const optB = { id: newUserMetadataOptionId(), key: 'approved', label: 'Approved' }
    const fA: UserMetadataField = {
      id: newUserMetadataFieldId(),
      key: 'review_state',
      name: 'State',
      type: 'choice',
      choices: [optA],
      showAsColumn: false
    }
    const fB: UserMetadataField = {
      id: newUserMetadataFieldId(),
      key: 'review_state',
      name: 'State',
      type: 'choice',
      choices: [optB],
      showAsColumn: false
    }
    const catalog = [fA, fB]
    const q = parseEverythingQuery('meta.review_state:approved', { userMetadataFields: catalog })
    expect(q.metaClauses[0]?.fieldIds).toEqual([fA.id, fB.id])
    expect(q.metaClauses[0]?.optionIds).toEqual([optA.id, optB.id])
    const doc: UserMetadataDoc = {
      format: 'MyFileExplorer.UserMetadata',
      version: 1,
      updatedAt: new Date().toISOString(),
      values: { [fB.id]: optB.id }
    }
    expect(
      metaRecordMatches(
        doc,
        {
          hasMeta: false,
          excludeHasMeta: false,
          fieldPresent: [],
          excludeFieldPresent: [],
          clauses: q.metaClauses
        },
        catalog
      )
    ).toBe(true)
  })

  it('matches ADS values by opaque ids', () => {
    const doc: UserMetadataDoc = {
      format: 'MyFileExplorer.UserMetadata',
      version: 1,
      updatedAt: new Date().toISOString(),
      values: {
        [fields[0]!.id]: reviewOpt.id,
        [fields[1]!.id]: 5
      }
    }
    const q = parseEverythingQuery('meta.review_state:awaiting_review meta.rating:>=4', {
      userMetadataFields: fields
    })
    expect(
      metaRecordMatches(
        doc,
        {
          hasMeta: false,
          excludeHasMeta: false,
          fieldPresent: q.metaFieldPresent,
          excludeFieldPresent: [],
          clauses: q.metaClauses
        },
        fields
      )
    ).toBe(true)
  })
})

describe('power search builder meta emit', () => {
  it('regenerates keys from opaque ids', () => {
    const state = {
      ...defaultPowerSearchState(),
      metaFilters: [{ fieldId: fields[0]!.id, optionId: reviewOpt.id }]
    }
    expect(buildSearchQuery(state, { userMetadataFields: fields })).toBe(
      'meta.review_state:awaiting_review'
    )
  })
})

describe('settings export userMetadata', () => {
  it('round-trips sets and bindings', () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      userMetadata: {
        sets: [{ id: setId, name: 'Default', fields }],
        bindings: [{ path: 'E:\\Research', recursive: true, setId }]
      }
    })
    const doc = buildSettingsExportDocument({ settings, networkHosts: [] })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.userMetadata.sets).toHaveLength(1)
    expect(allUserMetadataFields(parsed.settings.userMetadata)[0]?.key).toBe('review_state')
    expect(parsed.settings.userMetadata.bindings[0]?.path).toBe('E:\\Research')
    expect(parsed.settings.userMetadata.enabled).toBe(false)
  })

  it('round-trips enabled flag', () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      userMetadata: {
        enabled: true,
        sets: [{ id: setId, name: 'Default', fields }],
        bindings: []
      }
    })
    const doc = buildSettingsExportDocument({ settings, networkHosts: [] })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.userMetadata.enabled).toBe(true)
  })
})
