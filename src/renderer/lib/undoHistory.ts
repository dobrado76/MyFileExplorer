export type UndoPathPair = { from: string; to: string }

/** One reversible file-system action (Explorer-style undo). */
export type UndoEntry =
  | { kind: 'trash'; paths: string[]; label: string }
  | { kind: 'create'; paths: string[]; label: string }
  | { kind: 'copy'; paths: string[]; label: string }
  | { kind: 'rename'; from: string; to: string; label: string }
  | { kind: 'move'; pairs: UndoPathPair[]; label: string }
  | { kind: 'power-rename'; pairs: UndoPathPair[]; label: string }

export const MAX_UNDO = 30

export function pushCapped<T>(stack: T[], entry: T, max = MAX_UNDO): T[] {
  const next = [...stack, entry]
  if (next.length <= max) return next
  return next.slice(next.length - max)
}

export function undoActionTitle(entry: UndoEntry): string {
  switch (entry.kind) {
    case 'trash':
      return entry.paths.length === 1 ? 'Undo Delete' : `Undo Delete (${entry.paths.length})`
    case 'create':
      return entry.paths.length === 1 ? 'Undo New' : `Undo New (${entry.paths.length})`
    case 'copy':
      return entry.paths.length === 1 ? 'Undo Copy' : `Undo Copy (${entry.paths.length})`
    case 'rename':
      return 'Undo Rename'
    case 'move':
      return entry.pairs.length === 1 ? 'Undo Move' : `Undo Move (${entry.pairs.length})`
    case 'power-rename':
      return entry.pairs.length === 1
        ? 'Undo Power Rename'
        : `Undo Power Rename (${entry.pairs.length})`
  }
}

export function redoActionTitle(entry: UndoEntry): string {
  return undoActionTitle(entry).replace(/^Undo/, 'Redo')
}

/** Paths that should be selected / focused after undoing this entry. */
export function pathsAfterUndo(entry: UndoEntry): string[] {
  switch (entry.kind) {
    case 'trash':
      return [...entry.paths]
    case 'create':
    case 'copy':
      return []
    case 'rename':
      return [entry.from]
    case 'move':
    case 'power-rename':
      return entry.pairs.map((p) => p.from)
  }
}

/** Paths that should be selected after redoing this entry. */
export function pathsAfterRedo(entry: UndoEntry): string[] {
  switch (entry.kind) {
    case 'trash':
      return []
    case 'create':
    case 'copy':
      return [...entry.paths]
    case 'rename':
      return [entry.to]
    case 'move':
    case 'power-rename':
      return entry.pairs.map((p) => p.to)
  }
}
