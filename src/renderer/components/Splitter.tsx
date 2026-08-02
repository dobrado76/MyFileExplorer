import { useCallback, useRef, useState, type JSX } from 'react'

type Props = {
  /** called with px delta from drag start; consumer clamps */
  onDrag(deltaPx: number): void
  onDragEnd?(): void
}

export function Splitter({ onDrag, onDragEnd }: Props): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      startX.current = e.clientX
      setDragging(true)
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const move = (ev: PointerEvent): void => {
        onDrag(ev.clientX - startX.current)
        startX.current = ev.clientX
      }
      const up = (): void => {
        setDragging(false)
        onDragEnd?.()
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [onDrag, onDragEnd]
  )

  return (
    <div
      className={`splitter${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
    />
  )
}
