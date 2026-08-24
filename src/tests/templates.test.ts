import { describe, expect, it } from 'vitest'
import {
  sanitizeFileTemplates,
  sanitizeTemplateStem,
  templateCreatedName,
  templateDefaultStem,
  templateInputLabel,
  uniqueTemplatePrettyName
} from '../shared/schemas/templates'

describe('file templates (D57)', () => {
  it('pretty name is the default stem; input name is the original file', () => {
    const [t] = sanitizeFileTemplates([
      {
        id: 'tpl_abc1_xyz2',
        name: 'Meeting notes',
        suggestedStem: 'OldStem',
        inputName: 'notes_v3.docx',
        sourceFile: 'tpl_abc1_xyz2.docx'
      }
    ])
    expect(t?.name).toBe('Meeting notes')
    expect(templateDefaultStem(t!)).toBe('Meeting notes')
    expect(templateInputLabel(t!)).toBe('notes_v3.docx')
  })

  it('fills missing inputName from the stored source file', () => {
    const [t] = sanitizeFileTemplates([
      {
        id: 'tpl_abc1_xyz2',
        name: 'Invoice',
        sourceFile: 'tpl_abc1_xyz2.xlsx'
      }
    ])
    expect(t?.inputName).toBe('tpl_abc1_xyz2.xlsx')
    expect(templateInputLabel(t!)).toBe('tpl_abc1_xyz2.xlsx')
    expect(templateDefaultStem(t!)).toBe('Invoice')
  })

  it('builds the default created name from pretty name + input extension', () => {
    const [t] = sanitizeFileTemplates([
      {
        id: 'tpl_abc1_xyz2',
        name: 'Meeting notes',
        inputName: 'notes_v3.docx',
        sourceFile: 'tpl_abc1_xyz2.docx'
      }
    ])
    expect(templateCreatedName(t!)).toBe('Meeting notes.docx')
  })

  it('assigns Name (2) when duplicating a pretty name', () => {
    expect(
      uniqueTemplatePrettyName('Meeting notes', [{ name: 'Meeting notes' }])
    ).toBe('Meeting notes (2)')
  })

  it('strips illegal filename characters from the pretty-name stem', () => {
    expect(sanitizeTemplateStem('Q1 / Report: draft', 'New file')).toBe('Q1 _ Report_ draft')
  })
})
