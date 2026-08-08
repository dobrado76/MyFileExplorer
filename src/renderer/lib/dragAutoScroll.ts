/**
 * Explorer-style auto-scroll while dragging files near the top/bottom of a
 * scrollable pane (file view, folder tree).
 *
 * Mark containers with `data-drag-scroll`. Call start/update/stop from the
 * active left/right drag gesture.
 */

const EDGE_PX = 56
const MAX_PX_PER_FRAME = 32

let running = false
let raf = 0
let lastX = 0
let lastY = 0

function scrollContainerAtEdge(el: HTMLElement, clientX: number, clientY: number): void {
  const rect = el.getBoundingClientRect()
  // Only when the pointer is horizontally over this pane (or slightly outside).
  if (clientX < rect.left - 8 || clientX > rect.right + 8) return
  if (rect.height < EDGE_PX * 2) return

  let dy = 0
  if (clientY < rect.top + EDGE_PX) {
    const depth = Math.min(EDGE_PX, Math.max(0, rect.top + EDGE_PX - clientY))
    const t = depth / EDGE_PX
    dy = -Math.ceil(MAX_PX_PER_FRAME * t * t)
  } else if (clientY > rect.bottom - EDGE_PX) {
    const depth = Math.min(EDGE_PX, Math.max(0, clientY - (rect.bottom - EDGE_PX)))
    const t = depth / EDGE_PX
    dy = Math.ceil(MAX_PX_PER_FRAME * t * t)
  }
  if (dy === 0) return
  const max = el.scrollHeight - el.clientHeight
  if (max <= 0) return
  el.scrollTop = Math.max(0, Math.min(max, el.scrollTop + dy))
}

function tick(): void {
  if (!running) return
  const nodes = document.querySelectorAll('[data-drag-scroll]')
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]
    if (el instanceof HTMLElement) scrollContainerAtEdge(el, lastX, lastY)
  }
  raf = window.requestAnimationFrame(tick)
}

/** Start the rAF loop (idempotent). */
export function startDragAutoScroll(clientX: number, clientY: number): void {
  lastX = clientX
  lastY = clientY
  if (running) return
  running = true
  raf = window.requestAnimationFrame(tick)
}

/** Update pointer position used by the scroll loop. */
export function updateDragAutoScrollPointer(clientX: number, clientY: number): void {
  lastX = clientX
  lastY = clientY
}

/** Stop scrolling when the drag ends or is cancelled. */
export function stopDragAutoScroll(): void {
  running = false
  if (raf) {
    window.cancelAnimationFrame(raf)
    raf = 0
  }
}
