import { useEffect, useLayoutEffect, useRef, type JSX } from 'react'
import {
  clearRenameIgnoreBlur,
  idleRenameGesture,
  onRenameBlur,
  onRenameClick,
  onRenamePointerDown,
  onRenamePointerUp,
  type RenameGesture
} from '../lib/renameGesture'

/** Shared inline rename field for file view and folder tree. */
export function RenameInput({
  name,
  isDir,
  onSubmit,
  onCancel,
  className = 'rename-input'
}: {
  name: string
  isDir: boolean
  onSubmit(value: string): void
  onCancel(): void
  className?: string
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  const submitted = useRef(false)
  const gesture = useRef<RenameGesture>(idleRenameGesture())
  const onSubmitRef = useRef(onSubmit)
  const onCancelRef = useRef(onCancel)
  useLayoutEffect(() => {
    onSubmitRef.current = onSubmit
    onCancelRef.current = onCancel
  })

  const finish = (value: string, mode: 'submit' | 'cancel'): void => {
    if (submitted.current) return
    submitted.current = true
    document.body.classList.remove('rename-selecting')
    if (mode === 'cancel') onCancelRef.current()
    else onSubmitRef.current(value)
  }

  useEffect(() => {
    submitted.current = false
    gesture.current = idleRenameGesture()
    const el = ref.current
    if (!el) return
    let userAdjusted = false
    const focus = (): void => {
      if (userAdjusted || submitted.current) return
      el.focus()
      const dot = name.lastIndexOf('.')
      if (!isDir && dot > 0) el.setSelectionRange(0, dot)
      else el.select()
    }
    focus()
    // Second pass after scroll-into-view / virtualizer settle.
    const id = window.setTimeout(focus, 50)

    const restoreSelection = (start: number | null, end: number | null): void => {
      if (submitted.current) return
      el.focus()
      if (start != null && end != null) el.setSelectionRange(start, end)
    }

    // Commit before any other click handler (navigate, select, tree) can tear
    // rename down without reading the typed value. A selection drag that
    // starts in the box and is released outside is not a click-away.
    const onPointerDownCapture = (e: PointerEvent): void => {
      if (submitted.current || e.button !== 0) return
      const inside = e.target instanceof Node && el.contains(e.target)
      const next = onRenamePointerDown(gesture.current, inside)
      gesture.current = next.gesture
      if (inside) {
        userAdjusted = true
        window.clearTimeout(id)
        document.body.classList.add('rename-selecting')
        return
      }
      if (next.commit) finish(el.value, 'submit')
    }
    const onPointerUpCapture = (e: PointerEvent): void => {
      if (submitted.current) return
      const inside = e.target instanceof Node && el.contains(e.target)
      const next = onRenamePointerUp(gesture.current, inside)
      gesture.current = next.gesture
      if (!next.restore) {
        document.body.classList.remove('rename-selecting')
        return
      }
      const start = el.selectionStart
      const end = el.selectionEnd
      restoreSelection(start, end)
      requestAnimationFrame(() => {
        document.body.classList.remove('rename-selecting')
        if (submitted.current) return
        restoreSelection(start, end)
        gesture.current = clearRenameIgnoreBlur(gesture.current)
      })
    }
    const onClickCapture = (e: MouseEvent): void => {
      if (submitted.current) return
      const inside = e.target instanceof Node && el.contains(e.target)
      const next = onRenameClick(gesture.current, inside)
      gesture.current = next.gesture
      if (!next.swallow) return
      e.preventDefault()
      e.stopPropagation()
      restoreSelection(el.selectionStart, el.selectionEnd)
    }
    document.addEventListener('pointerdown', onPointerDownCapture, true)
    document.addEventListener('pointerup', onPointerUpCapture, true)
    document.addEventListener('click', onClickCapture, true)

    return () => {
      window.clearTimeout(id)
      document.body.classList.remove('rename-selecting')
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
      document.removeEventListener('pointerup', onPointerUpCapture, true)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [name, isDir])

  return (
    <input
      ref={ref}
      className={className}
      defaultValue={name}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(e.currentTarget.value, 'submit')
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          finish(e.currentTarget.value, 'cancel')
        }
      }}
      onBlur={() => {
        if (submitted.current) return
        const decision = onRenameBlur(gesture.current)
        if (!decision.commit) {
          if (decision.refocus) {
            const node = ref.current
            const start = node?.selectionStart ?? null
            const end = node?.selectionEnd ?? null
            requestAnimationFrame(() => {
              if (submitted.current || !node) return
              node.focus()
              if (start != null && end != null) node.setSelectionRange(start, end)
            })
          }
          return
        }
        finish(ref.current?.value ?? name, 'submit')
      }}
      aria-label="Rename"
    />
  )
}
