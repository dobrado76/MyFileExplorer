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

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    const dot = name.lastIndexOf('.')
    if (!isDir && dot > 0) el.setSelectionRange(0, dot)
    else el.select()
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
          submitted.current = true
          onSubmit(e.currentTarget.value)
        }
        if (e.key === 'Escape') {
          submitted.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (!submitted.current) onSubmit(ref.current?.value ?? name)
      }}
      aria-label="Rename"
    />
  )
}
