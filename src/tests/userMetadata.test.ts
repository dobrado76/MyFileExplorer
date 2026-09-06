import { describe, expect, it } from 'vitest'
import { parseEverythingQuery } from '../main/search/everythingQuery'
import { metaRecordMatches } from '../shared/metaSearch'
import {
  allUserMetadataFields,
  formatBooleanFieldValue,
  formatIconTagsColumnValue,
  newUserMetadataFieldId,
  newUserMetadataOptionId,
  newUserMetadataSetId,
  parseBooleanFieldToken,
  parseIconTagsColumnValue,
  type UserMetadataDoc,
  type UserMetadataField,
  userMetadataFieldSchema,
  userMetadataSettingsSchema
} from '../shared/schemas/userMetadata'
import {
  canFollowUserMetadataLink,
  classifyUserMetadataLink,
  validateUserMetadataLinkValue,
  windowsPathRelativeTo
} from '../shared/userMetadataLink'
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

describe('boolean field labels', () => {
  const doneField: UserMetadataField = {
    id: newUserMetadataFieldId(),
    key: 'task_state',
    name: 'Task',
    type: 'boolean',
    boolean: { trueLabel: 'Done', falseLabel: 'Todo' },
    showAsColumn: true
  }

  it('defaults to Yes/No when labels omitted', () => {
    const f: UserMetadataField = {
      id: newUserMetadataFieldId(),
      key: 'flag',
      name: 'Flag',
      type: 'boolean',
      showAsColumn: false
    }
    expect(formatBooleanFieldValue(f, true)).toBe('Yes')
    expect(formatBooleanFieldValue(f, false)).toBe('No')
    expect(parseBooleanFieldToken(f, 'yes')).toBe(true)
    expect(parseBooleanFieldToken(f, 'no')).toBe(false)
  })

  it('uses custom labels for display and query tokens', () => {
    expect(formatBooleanFieldValue(doneField, true)).toBe('Done')
    expect(formatBooleanFieldValue(doneField, false)).toBe('Todo')
    expect(parseBooleanFieldToken(doneField, 'Done')).toBe(true)
    expect(parseBooleanFieldToken(doneField, 'todo')).toBe(false)
    expect(parseBooleanFieldToken(doneField, 'true')).toBe(true)
  })

  it('preserves boolean labels through field schema', () => {
    const parsed = userMetadataFieldSchema.parse(doneField)
    expect(parsed.boolean).toEqual({ trueLabel: 'Done', falseLabel: 'Todo' })
  })

  it('parses meta query with custom label', () => {
    const q = parseEverythingQuery('meta.task_state:Done', {
      userMetadataFields: [doneField]
    })
    expect(q.metaClauses[0]?.value).toBe(true)
  })
})

describe('link field values', () => {
  it('accepts link type in field schema', () => {
    const parsed = userMetadataFieldSchema.parse({
      id: newUserMetadataFieldId(),
      key: 'homepage',
      name: 'Homepage',
      type: 'link',
      showAsColumn: true
    })
    expect(parsed.type).toBe('link')
  })

  it('classifies urls, absolute paths, and relatives', () => {
    expect(classifyUserMetadataLink('https://example.com/a')).toEqual({
      kind: 'url',
      url: 'https://example.com/a'
    })
    expect(classifyUserMetadataLink('C:\\Projects\\readme.md')).toEqual({
      kind: 'path',
      path: 'C:\\Projects\\readme.md'
    })
    expect(classifyUserMetadataLink('docs\\a.md', 'C:\\Projects\\item')).toEqual({
      kind: 'path',
      path: 'C:\\Projects\\item\\docs\\a.md'
    })
    expect(classifyUserMetadataLink('file:///C:/foo/bar.txt')).toEqual({
      kind: 'path',
      path: 'C:\\foo\\bar.txt'
    })
  })

  it('validates and rejects unsafe schemes', () => {
    expect(validateUserMetadataLinkValue('https://ok').ok).toBe(true)
    expect(validateUserMetadataLinkValue('C:\\a').ok).toBe(true)
    expect(validateUserMetadataLinkValue('javascript:alert(1)').ok).toBe(false)
    expect(canFollowUserMetadataLink('https://ok', null)).toBe(true)
    expect(canFollowUserMetadataLink('rel\\x', null)).toBe(false)
    expect(canFollowUserMetadataLink('rel\\x', 'D:\\root')).toBe(true)
  })

  it('computes relative paths for Shift+drop / Shift+Browse', () => {
    expect(windowsPathRelativeTo('C:\\Proj', 'C:\\Proj\\docs\\a.md')).toBe('docs\\a.md')
    expect(windowsPathRelativeTo('C:\\Proj\\src', 'C:\\Proj\\docs\\a.md')).toBe('..\\docs\\a.md')
    expect(windowsPathRelativeTo('D:\\a', 'C:\\b')).toBeNull()
  })

  it('does not wipe sibling fields when one field is invalid', () => {
    const keepId = newUserMetadataFieldId()
    const setId = newUserMetadataSetId()
    const parsed = userMetadataSettingsSchema.parse({
      enabled: true,
      showToolbarButton: false,
      sets: [
        {
          id: setId,
          name: 'Keep me',
          fields: [
            {
              id: keepId,
              key: 'title',
              name: 'Title',
              type: 'text',
              showAsColumn: false
            },
            {
              id: newUserMetadataFieldId(),
              key: 'bad',
              name: 'Bad',
              type: 'not_a_real_type',
              showAsColumn: false
            },
            {
              id: newUserMetadataFieldId(),
              key: 'site',
              name: 'Site',
              type: 'link',
              showAsColumn: true
            }
          ]
        }
      ],
      bindings: []
    })
    expect(parsed.sets).toHaveLength(1)
    expect(parsed.sets[0]!.fields.map((f) => f.key).sort()).toEqual(['site', 'title'])
  })
})

describe('icon tags', () => {
  const tagA = {
    id: newUserMetadataOptionId(),
    key: 'star',
    label: 'Star',
    lucideName: 'Star',
    lucideColor: '#fbbf24'
  }
  const tagB = {
    id: newUserMetadataOptionId(),
    key: 'flag',
    label: 'Flag',
    lucideName: 'Flag',
    lucideColor: '#f87171'
  }
  const iconField: UserMetadataField = {
    id: newUserMetadataFieldId(),
    key: 'tags',
    name: 'Tags',
    type: 'iconTags',
    choices: [tagA, tagB],
    showAsColumn: true
  }

  it('requires lucideName on icon tag options', () => {
    const bad = userMetadataFieldSchema.safeParse({
      ...iconField,
      choices: [{ id: tagA.id, key: 'star', label: 'Star' }]
    })
    expect(bad.success).toBe(false)
  })

  it('accepts iconTags with glyphs', () => {
    expect(userMetadataFieldSchema.parse(iconField).type).toBe('iconTags')
  })

  it('encodes and parses Details column tokens', () => {
    const raw = formatIconTagsColumnValue(iconField, [tagB.id])
    expect(raw).toBe(`${tagA.id}:0;${tagB.id}:1`)
    expect(parseIconTagsColumnValue(raw)).toEqual([
      { id: tagA.id, on: false },
      { id: tagB.id, on: true }
    ])
  })

  it('matches Power Search like multi-choice', () => {
    const q = parseEverythingQuery('meta.tags:flag', { userMetadataFields: [iconField] })
    expect(q.metaClauses[0]?.optionIds).toEqual([tagB.id])
    const doc: UserMetadataDoc = {
      format: 'MyFileExplorer.UserMetadata',
      version: 1,
      updatedAt: new Date().toISOString(),
      values: { [iconField.id]: [tagB.id] }
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
        [iconField]
      )
    ).toBe(true)
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

  it('round-trips showToolbarButton (D45)', () => {
    const settings = settingsSchema.parse({
      ...defaultSettings,
      userMetadata: {
        enabled: true,
        showToolbarButton: true,
        sets: [],
        bindings: []
      }
    })
    const doc = buildSettingsExportDocument({ settings, networkHosts: [] })
    const parsed = parseSettingsImport(doc)
    expect(parsed.settings.userMetadata.showToolbarButton).toBe(true)
  })
})
