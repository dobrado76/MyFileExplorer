import { describe, expect, it } from 'vitest'
import {
  findExactMetadataBinding,
  parentPath,
  removeBindingsForSet,
  resolveMetadataBinding,
  resolveMetadataSet,
  upsertMetadataBinding,
  type UserMetadataBinding
} from '@shared/userMetadataBindings'
import {
  MIGRATED_DEFAULT_SET_ID,
  migrateUserMetadataSettings,
  newUserMetadataFieldId,
  newUserMetadataSetId,
  userMetadataSettingsSchema,
  type UserMetadataSettings
} from '@shared/schemas/userMetadata'
import { settingsSchema, defaultSettings } from '@shared/schemas/settings'

function binding(
  path: string,
  recursive: boolean,
  setId: string | null
): UserMetadataBinding {
  return { path, recursive, setId }
}

describe('resolveMetadataBinding', () => {
  const research = 'ms_research000001'
  const list = [
    binding('E:\\Research', true, research),
    binding('E:\\Research\\Temporary', false, null)
  ]

  it('prefers exact No metadata over recursive ancestor set', () => {
    const hit = resolveMetadataBinding('E:\\Research\\Temporary', list)
    expect(hit?.setId).toBeNull()
    expect(resolveMetadataSet('E:\\Research\\Temporary', {
      enabled: false,
      sets: [{ id: research, name: 'Research', fields: [] }],
      bindings: list
    })).toBeNull()
  })

  it('inherits recursive set under project', () => {
    expect(resolveMetadataBinding('E:\\Research\\Papers', list)?.setId).toBe(research)
  })

  it('picks longest recursive ancestor', () => {
    const nested = [
      binding('E:\\', true, 'ms_root0000000001'),
      binding('E:\\Media', true, 'ms_media00000001')
    ]
    expect(resolveMetadataBinding('E:\\Media\\Movies', nested)?.setId).toBe('ms_media00000001')
  })

  it('remove assignment restores inheritance', () => {
    const after = list.filter((b) => b.path !== 'E:\\Research\\Temporary')
    expect(resolveMetadataBinding('E:\\Research\\Temporary', after)?.setId).toBe(research)
  })
})

describe('parentPath', () => {
  it('returns parent folder', () => {
    expect(parentPath('E:\\Research\\a.py')).toBe('E:\\Research')
  })
  it('keeps volume root', () => {
    expect(parentPath('E:\\file.txt')).toBe('E:\\')
  })
})

describe('upsert / removeBindingsForSet', () => {
  it('upsert replaces same path', () => {
    let list = [binding('E:\\A', false, 'ms_a0000000000001')]
    list = upsertMetadataBinding(list, binding('E:\\A', true, null))
    expect(list).toHaveLength(1)
    expect(list[0]!.recursive).toBe(true)
    expect(list[0]!.setId).toBeNull()
  })

  it('strips bindings when set deleted', () => {
    const list = [
      binding('E:\\A', true, 'ms_gone0000000001'),
      binding('E:\\B', false, null),
      binding('E:\\C', false, 'ms_keep0000000001')
    ]
    const next = removeBindingsForSet(list, 'ms_gone0000000001')
    expect(next).toHaveLength(2)
    expect(findExactMetadataBinding('E:\\B', next)?.setId).toBeNull()
  })
})

describe('migrateUserMetadataSettings', () => {
  it('wraps legacy fields into Default set with no bindings', () => {
    const fid = newUserMetadataFieldId()
    const m = migrateUserMetadataSettings({
      fields: [{ id: fid, key: 'rating', name: 'Rating', type: 'number', showAsColumn: false }]
    })
    expect(m.sets).toHaveLength(1)
    expect(m.sets[0]!.id).toBe(MIGRATED_DEFAULT_SET_ID)
    expect(m.sets[0]!.name).toBe('Default')
    expect(m.bindings).toEqual([])
    expect(settingsSchema.parse({ ...defaultSettings, userMetadata: { fields: m.sets[0]!.fields } })
      .userMetadata.sets[0]!.fields[0]!.key).toBe('rating')
  })

  it('rejects cross-set key type mismatch', () => {
    const a = newUserMetadataSetId()
    const b = newUserMetadataSetId()
    const settings: UserMetadataSettings = {
      enabled: false,
      sets: [
        {
          id: a,
          name: 'A',
          fields: [
            {
              id: newUserMetadataFieldId(),
              key: 'status',
              name: 'Status',
              type: 'choice',
              choices: [{ id: 'mo_aaaaaa', key: 'ok', label: 'OK' }],
              showAsColumn: false
            }
          ]
        },
        {
          id: b,
          name: 'B',
          fields: [
            {
              id: newUserMetadataFieldId(),
              key: 'status',
              name: 'Status',
              type: 'text',
              showAsColumn: false
            }
          ]
        }
      ],
      bindings: []
    }
    expect(userMetadataSettingsSchema.safeParse(settings).success).toBe(false)
  })

  it('allows same key when types match', () => {
    const a = newUserMetadataSetId()
    const b = newUserMetadataSetId()
    const settings: UserMetadataSettings = {
      enabled: true,
      sets: [
        {
          id: a,
          name: 'A',
          fields: [
            {
              id: newUserMetadataFieldId(),
              key: 'rating',
              name: 'Rating',
              type: 'number',
              showAsColumn: false
            }
          ]
        },
        {
          id: b,
          name: 'B',
          fields: [
            {
              id: newUserMetadataFieldId(),
              key: 'rating',
              name: 'Rating',
              type: 'number',
              showAsColumn: false
            }
          ]
        }
      ],
      bindings: []
    }
    expect(userMetadataSettingsSchema.safeParse(settings).success).toBe(true)
  })
})
