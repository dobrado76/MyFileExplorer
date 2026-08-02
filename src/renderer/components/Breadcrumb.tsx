import { useEffect, useRef, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { segmentsOf, looksAbsolute, normalizeSlashes, stripTrailingSep, isUnderPath } from '../lib/paths'
import { api, call } from '../lib/ipc'
import { ChevronRight } from '../lib/icons'

export function Breadcrumb(): JSX.Element {
  const path = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.path ?? '')
  const rootPath = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.rootPath ?? null)
  const addressEditing = useAppStore((s) => s.addressEditing)
  const setAddressEditing = useAppStore((s) => s.setAddressEditing)
  const navigate = useAppStore((s) => s.navigate)
  const notify = useAppStore((s) => s.notify)

  const [text, setText] = useState(path)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addressEditing) {
      setText(path)
      // focus after mount
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [addressEditing, path])

  const submit = async (): Promise<void> => {
    const target = stripTrailingSep(normalizeSlashes(text.trim()))
    setAddressEditing(false)
    if (!target || !looksAbsolute(target)) {
      if (target) notify('Enter an absolute path like C:\\folder or \\\\server\\share', true)
      return
    }
    try {
      const { exists } = await call(api.fs.exists({ path: target }))
      if (!exists) {
        notify(`Path not found: ${target}`, true)
        return
      }
      await navigate(target)
    } catch {
      notify(`Cannot open: ${target}`, true)
    }
  }

  if (addressEditing) {
    return (
      <div className="breadcrumb">
        <input
          ref={inputRef}
          className="address-input"
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') setAddressEditing(false)
            e.stopPropagation()
          }}
          onBlur={() => setAddressEditing(false)}
          aria-label="Address"
        />
      </div>
    )
  }

  // Scoped tab: only show segments from the tab's root folder down.
  const segments = rootPath
    ? segmentsOf(path).filter((seg) => isUnderPath(seg.path, rootPath))
    : segmentsOf(path)
  const MAX_VISIBLE = 5
  const collapsed = segments.length > MAX_VISIBLE
  const head = collapsed ? segments.slice(0, 1) : []
  const hidden = collapsed ? segments.slice(1, segments.length - (MAX_VISIBLE - 2)) : []
  const visible = collapsed ? segments.slice(segments.length - (MAX_VISIBLE - 2)) : segments

  return (
    <div
      className="breadcrumb"
      onDoubleClick={() => setAddressEditing(true)}
      title="Double-click or Ctrl+L to type a path"
    >
      {head.map((seg) => (
        <span key={seg.path} style={{ display: 'contents' }}>
          <button className="crumb" onClick={() => void navigate(seg.path)}>
            {seg.label}
          </button>
          <span className="crumb-sep">
            <ChevronRight size={12} />
          </span>
        </span>
      ))}
      {hidden.length > 0 && (
        <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <button
            className="crumb-overflow"
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label="Show hidden path segments"
          >
            …
          </button>
          {overflowOpen && (
            <div
              className="context-menu"
              style={{ position: 'absolute', top: '100%', left: 0 }}
              onMouseLeave={() => setOverflowOpen(false)}
            >
              {hidden.map((seg) => (
                <button
                  key={seg.path}
                  className="menu-item"
                  onClick={() => {
                    setOverflowOpen(false)
                    void navigate(seg.path)
                  }}
                >
                  {seg.label}
                </button>
              ))}
            </div>
          )}
          <span className="crumb-sep">
            <ChevronRight size={12} />
          </span>
        </span>
      )}
      {visible.map((seg, i) => (
        <span key={seg.path} style={{ display: 'contents' }}>
          <button className="crumb" onClick={() => void navigate(seg.path)}>
            {seg.label}
          </button>
          {i < visible.length - 1 && (
            <span className="crumb-sep">
              <ChevronRight size={12} />
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
