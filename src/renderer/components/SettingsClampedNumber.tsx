import { useEffect, useState, type JSX } from 'react'

/**
 * Typeable number field: draft while editing, clamp + commit on blur / Enter /
 * when the typed value is already in range (so mid-edit "8" is not forced back to 4096).
 */
export function SettingsClampedNumber({
  id,
  value,
  min,
  max,
  step = 1,
  title,
  onCommit
}: {
  id?: string
  value: number
  min: number
  max: number
  step?: number
  title?: string
  onCommit: (n: number) => void
}): JSX.Element {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  function clamp(n: number): number {
    return Math.min(max, Math.max(min, Math.round(n)))
  }

  function commitRaw(raw: string): void {
    const n = Number(raw)
    const next = Number.isFinite(n) ? clamp(n) : clamp(value)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
    <input
      id={id}
      type="number"
      min={min}
      max={max}
      step={step}
      inputMode="numeric"
      title={title}
      value={draft}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') return
        const n = Number(raw)
        if (Number.isFinite(n) && n >= min && n <= max) onCommit(Math.round(n))
      }}
      onBlur={() => commitRaw(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          commitRaw(draft)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}
