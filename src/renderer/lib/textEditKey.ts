const NON_TEXT_INPUT = new Set([
  'button',
  'checkbox',
  'radio',
  'submit',
  'reset',
  'file',
  'range',
  'color',
  'image'
])

/** Input, textarea, or contenteditable — not buttons or checkboxes. */
export function textEditingElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null
  if (target.isContentEditable && target.getAttribute('contenteditable') !== 'false') return target
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return target
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type.toLowerCase()
    if (NON_TEXT_INPUT.has(type)) return null
    return target
  }
  return null
}

/**
 * Del / Backspace while a filename is selected in the rename box clears that
 * selection; otherwise it removes one character. Never a file-delete.
 */
export function nextTextAfterDeleteKey(
  value: string,
  start: number,
  end: number,
  key: 'Delete' | 'Backspace'
): { value: string; caret: number } {
  const a = Math.max(0, Math.min(start, end, value.length))
  const b = Math.max(0, Math.min(Math.max(start, end), value.length))
  if (a !== b) return { value: value.slice(0, a) + value.slice(b), caret: a }
  if (key === 'Backspace') {
    if (a === 0) return { value, caret: 0 }
    return { value: value.slice(0, a - 1) + value.slice(a), caret: a - 1 }
  }
  if (a >= value.length) return { value, caret: a }
  return { value: value.slice(0, a) + value.slice(a + 1), caret: a }
}
