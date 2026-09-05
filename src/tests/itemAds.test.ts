import { describe, expect, it } from 'vitest'
import {
  parseItemIcon,
  parseItemNote,
  itemNoteSchema,
  itemIconSchema
} from '../shared/schemas/itemAds'
import {
  encodeNoteChecklistColumn,
  itemNoteChecklistItems,
  itemNoteOpenTodos,
  noteChecklistPlainText,
  noteRecordMatches,
  parseNoteChecklistColumn
} from '../shared/noteSearch'
import {
  columnNeedsDirectoryMeta,
  filterDirectoryMetaFetchColumns,
  filterFileMetaFetchColumns,
  isItemNoteColumnId
} from '../shared/schemas/columns'

describe('item note / icon schemas', () => {
  it('parses a note and rejects junk', () => {
    const note = parseItemNote(
      JSON.stringify({ text: 'Needs review', status: 'Waiting', updatedAt: 1 })
    )
    expect(note?.text).toBe('Needs review')
    expect(note?.status).toBe('Waiting')
    expect(parseItemNote('not-json')).toBeNull()
    expect(itemNoteSchema.parse({ text: 'x' }).text).toBe('x')
  })

  it('parses lucide / shell / custom icons and rejects stacked kinds', () => {
    expect(parseItemIcon(JSON.stringify({ kind: 'lucide', name: 'Star', color: '#60a5fa' }))).toEqual(
      { kind: 'lucide', name: 'Star', color: '#60a5fa' }
    )
    expect(parseItemIcon(JSON.stringify({ kind: 'shell', color: '#f87171' }))?.kind).toBe('shell')
    expect(parseItemIcon(JSON.stringify({ kind: 'custom' }))?.kind).toBe('custom')
    expect(parseItemIcon(JSON.stringify({ kind: 'nope' }))).toBeNull()
    expect(() => itemIconSchema.parse({ kind: 'both' })).toThrow()
  })

  it('accepts optional pack on lucide item icons (multi-pack)', () => {
    expect(
      parseItemIcon(
        JSON.stringify({ kind: 'lucide', name: 'Star', color: '#60a5fa', pack: 'tabler' })
      )
    ).toEqual({ kind: 'lucide', name: 'Star', color: '#60a5fa', pack: 'tabler' })
  })
})

describe('note search match', () => {
  const note = parseItemNote(
    JSON.stringify({
      text: 'Call the lab',
      status: 'Needs review',
      checklist: [
        { text: 'TODO buy film', done: false },
        { text: 'scan negs', done: true }
      ],
      updatedAt: 1
    })
  )

  it('matches note text, status, and open checklist items', () => {
    expect(itemNoteOpenTodos(note)).toEqual(['TODO buy film'])
    expect(itemNoteChecklistItems(note)).toEqual([
      { text: 'TODO buy film', done: false },
      { text: 'scan negs', done: true }
    ])
    const encoded = encodeNoteChecklistColumn(itemNoteChecklistItems(note)!)
    expect(noteChecklistPlainText(parseNoteChecklistColumn(encoded))).toBe(
      'TODO buy film; scan negs'
    )
    expect(parseNoteChecklistColumn(encoded)[1]?.done).toBe(true)
    expect(
      noteRecordMatches(note, {
        hasNote: true,
        excludeHasNote: false,
        noteText: 'lab',
        noteStatus: null,
        openTodo: false,
        openTodoNeedle: null
      })
    ).toBe(true)
    expect(
      noteRecordMatches(note, {
        hasNote: false,
        excludeHasNote: false,
        noteText: null,
        noteStatus: 'review',
        openTodo: true,
        openTodoNeedle: 'film'
      })
    ).toBe(true)
    expect(
      noteRecordMatches(note, {
        hasNote: false,
        excludeHasNote: false,
        noteText: null,
        noteStatus: null,
        openTodo: true,
        openTodoNeedle: 'scan'
      })
    ).toBe(false)
    expect(
      noteRecordMatches(null, {
        hasNote: false,
        excludeHasNote: true,
        noteText: null,
        noteStatus: null,
        openTodo: false,
        openTodoNeedle: null
      })
    ).toBe(true)
  })
})

describe('item note columns', () => {
  it('treats note columns as directory meta (folders can have notes)', () => {
    for (const id of ['itemNote', 'itemNoteStatus', 'itemHasNote', 'itemNoteTodos'] as const) {
      expect(isItemNoteColumnId(id)).toBe(true)
      expect(columnNeedsDirectoryMeta(id)).toBe(true)
    }
    expect(
      filterFileMetaFetchColumns(['size', 'ads', 'itemNote', 'fsFileCount'])
    ).toEqual(['ads', 'itemNote'])
    expect(
      filterDirectoryMetaFetchColumns(['mtime', 'itemNote', 'itemHasNote', 'ads'])
    ).toEqual(['itemNote', 'itemHasNote', 'ads'])
  })
})
