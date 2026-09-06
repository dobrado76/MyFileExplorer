import {
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'
import { canFollowUserMetadataLink } from '@shared/userMetadataLink'
import {
  copyUserMetadataLinkValue,
  followUserMetadataLink,
  probeUserMetadataLinkPath,
  revealUserMetadataLink
} from '../lib/userMetadataLink'

/**
 * Details column cell for Link metadata: click Open, middle-click Reveal,
 * context menu Open / Reveal / Copy; amber hint when path is missing.
 */
export function UserMetadataLinkCell({
  text,
  baseDir
}: {
  text: string
  baseDir: string | null
}): ReactNode {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [missing, setMissing] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!text.trim() || !canFollowUserMetadataLink(text, baseDir)) {
      setMissing(false)
      return
    }
    void (async () => {
      const r = await probeUserMetadataLinkPath(text, baseDir)
      if (!cancelled) setMissing(r === 'missing')
    })()
    return () => {
      cancelled = true
    }
  }, [text, baseDir])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])

  if (!text) return ''
  const canOpen = canFollowUserMetadataLink(text, baseDir)
  if (!canOpen) {
    return <span className={missing ? 'details-meta-link-missing-text' : undefined}>{text}</span>
  }

  return (
    <>
      <button
        type="button"
        className={`details-meta-link${missing ? ' is-missing' : ''}`}
        title={missing ? `${text} (path not found) — click Open, middle-click Reveal` : `${text} — click Open, middle-click Reveal`}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          void followUserMetadataLink(text, baseDir)
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return
          e.stopPropagation()
          e.preventDefault()
          void revealUserMetadataLink(text, baseDir)
        }}
        onContextMenu={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {text}
      </button>
      {missing ? <span className="details-meta-link-missing-mark" title="Path not found">!</span> : null}
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              className="details-meta-link-menu"
              style={{ left: menu.x, top: menu.y }}
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void followUserMetadataLink(text, baseDir)
                }}
              >
                Open
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void revealUserMetadataLink(text, baseDir)
                }}
              >
                Reveal
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  void copyUserMetadataLinkValue(text)
                }}
              >
                Copy
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
