import { useEffect, useRef, type JSX } from 'react'

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
  const onSubmitRef = useRef(onSubmit)
  const onCancelRef = useRef(onCancel)
  onSubmitRef.current = onSubmit
  onCancelRef.current = onCancel

  const finish = (value: string, mode: 'submit' | 'cancel'): void => {
    if (submitted.current) return
    submitted.current = true
    if (mode === 'cancel') onCancelRef.current()
    else onSubmitRef.current(value)
  }

  useEffect(() => {
    submitted.current = false
    const el = ref.current
    if (!el) return
    const focus = (): void => {
      el.focus()
      const dot = name.lastIndexOf('.')
      if (!isDir && dot > 0) el.setSelectionRange(0, dot)
      else el.select()
    }
    focus()
    // Second pass after scroll-into-view / virtualizer settle.
    const id = window.setTimeout(focus, 50)

    // Commit before any other click handler (navigate, select, tree) can tear
    // rename down without reading the typed value. Escape still cancels.
    const onPointerDownCapture = (e: PointerEvent): void => {
      if (submitted.current) return
      if (!(e.target instanceof Node) || el.contains(e.target)) return
      finish(el.value, 'submit')
    }
    document.addEventListener('pointerdown', onPointerDownCapture, true)

    return () => {
      window.clearTimeout(id)
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
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
        // Click-away, tab-away, or focus move — always commit (Explorer-style).
        // Escape/Enter/outside pointer already set `submitted`.
        if (submitted.current) return
        finish(ref.current?.value ?? name, 'submit')
      }}
      aria-label="Rename"
    />
  )
}
