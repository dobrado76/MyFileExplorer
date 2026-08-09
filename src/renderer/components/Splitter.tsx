import { useCallback, useRef, useState, type JSX } from 'react'

type Props = {
  /** called with px delta from drag start; consumer clamps */
  onDrag(deltaPx: number): void
  onDragEnd?(): void
  /** vertical = left|right (default); horizontal = top|bottom */
  orientation?: 'vertical' | 'horizontal'
}

export function Splitter({
  onDrag,
  onDragEnd,
  orientation = 'vertical'
}: Props): JSX.Element {
  const [dragging, setDragging] = useState(false)
  const start = useRef(0)
  const horizontal = orientation === 'horizontal'

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      start.current = horizontal ? e.clientY : e.clientX
      setDragging(true)
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)

      const move = (ev: PointerEvent): void => {
        const pos = horizontal ? ev.clientY : ev.clientX
        onDrag(pos - start.current)
        start.current = pos
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
    [onDrag, onDragEnd, horizontal]
  )

  return (
    <div
      className={`splitter${horizontal ? ' splitter-h' : ''}${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={orientation}
    />
  )
}
