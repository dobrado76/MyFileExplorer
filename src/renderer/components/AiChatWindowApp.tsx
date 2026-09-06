import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type {
  AiChatConversation,
  AiChatStoreDocument,
  AiChatTopic,
  AiChatUiState
} from '@shared/schemas/aiChat'
import { ancestorTopicIds, childrenOfTopic, expandedTopicsFromUi, topicSubtreeIds } from '@shared/aiChat'
import { api, call } from '../lib/ipc'
import {
  ChevronDown,
  ChevronRight,
  CloseIcon,
  EditImageIcon,
  FileIcon,
  FolderIcon,
  VideoFileIcon
} from '../lib/icons'
import { useAppStore } from '../store/appStore'

marked.setOptions({ gfm: true, breaks: false })

const DND_TOPIC = 'application/x-mfe-ai-chat-topic'
const DND_CHAT = 'application/x-mfe-ai-chat-conversation'

function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style']
  })
}

function applyChrome(theme: string, fontFamily: string, fontSizePx: number): void {
  const rootEl = document.documentElement
  rootEl.dataset['theme'] = theme === 'custom' ? 'dark' : theme
  rootEl.style.setProperty('--font-family', `'${fontFamily}', system-ui, sans-serif`)
  rootEl.style.setProperty('--font-size', `${fontSizePx}px`)
}

export function AiChatWindowApp(): JSX.Element {
  const [doc, setDoc] = useState<AiChatStoreDocument | null>(null)
  const [activeTopicId, setActiveTopicId] = useState<string | null>(null)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<AiChatConversation | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cloudAckNeeded, setCloudAckNeeded] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const [topicDrop, setTopicDrop] = useState<{
    topicId: string
    mode: 'before' | 'after' | 'into'
  } | null>(null)
  const [dropRoot, setDropRoot] = useState(false)
  const [draggingTopicId, setDraggingTopicId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<
    | { kind: 'topic'; topic: AiChatTopic; x: number; y: number }
    | { kind: 'chat'; chat: AiChatConversation; x: number; y: number }
    | null
  >(null)
  const [textDialog, setTextDialog] = useState<{
    title: string
    initial: string
    confirmLabel: string
    onConfirm: (value: string) => void
  } | null>(null)
  const [textDialogValue, setTextDialogValue] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string
    confirmLabel: string
    onConfirm: () => void
  } | null>(null)
  const textDialogInputRef = useRef<HTMLInputElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const refreshSnapshot = useCallback(async (): Promise<AiChatStoreDocument> => {
    const next = await call(api.aiChat.snapshot())
    setDoc(next)
    return next
  }, [])

  const loadConversation = useCallback(async (id: string | null): Promise<void> => {
    if (!id) {
      setConversation(null)
      setActiveConversationId(null)
      return
    }
    try {
      const res = await call(api.aiChat.getConversation({ id }))
      setConversation(res.conversation)
      setActiveConversationId(id)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const settings = await call(api.settings.get())
        if (cancelled) return
        useAppStore.setState({ settings })
        applyChrome(settings.theme, settings.fontFamily, settings.fontSizePx)
        const provider = settings.ai.providers.find((p) => p.id === settings.ai.defaultProviderId)
        setCloudAckNeeded(
          Boolean(provider && !provider.local && !settings.ai.acknowledgedCloudGenerate)
        )
        const snap = await refreshSnapshot()
        if (cancelled) return
        const topicId = snap.ui.lastTopicId ?? snap.topics[0]?.id ?? null
        setActiveTopicId(topicId)
        setExpanded(expandedTopicsFromUi(snap.topics, snap.ui.expandedTopicIds, topicId))
        const convId = snap.ui.lastConversationId
        if (convId && snap.conversations.some((c) => c.id === convId)) {
          await loadConversation(convId)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    const unsub = api.onEvent((event) => {
      if (event.type === 'ai-chat-focus') {
        void (async () => {
          const snap = await refreshSnapshot()
          const conv = snap.conversations.find((c) => c.id === event.payload.conversationId)
          if (conv) {
            setActiveTopicId(conv.topicId)
            setExpanded((prev) => {
              const next = new Set(prev)
              next.add(conv.topicId)
              for (const id of ancestorTopicIds(snap.topics, conv.topicId)) next.add(id)
              void persistExpandedRef.current(next)
              return next
            })
          }
          await loadConversation(event.payload.conversationId)
        })()
      }
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [loadConversation, refreshSnapshot])

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [conversation?.messages.length, busy])

  const persistQueueRef = useRef(Promise.resolve())
  const persistUi = useCallback((patch: Partial<AiChatUiState>): Promise<void> => {
    setDoc((d) => (d ? { ...d, ui: { ...d.ui, ...patch } } : d))
    const run = persistQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const res = await call(api.aiChat.setUi(patch))
        return res.ui
      })
    persistQueueRef.current = run.then(() => undefined, () => undefined)
    return run
      .then((ui) => {
        setDoc((d) => (d ? { ...d, ui } : d))
      })
      .catch(() => undefined)
  }, [])

  const persistExpandedRef = useRef<(ids: Set<string>) => void>(() => {})
  persistExpandedRef.current = (ids: Set<string>): void => {
    void persistUi({ expandedTopicIds: [...ids] })
  }

  useEffect(() => {
    const flush = (): void => {
      persistExpandedRef.current(expandedRef.current)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      flush()
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  const topics = doc?.topics ?? []
  const conversations = useMemo(() => {
    if (!doc) return []
    if (!activeTopicId) {
      return [...doc.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }
    const ids = topicSubtreeIds(doc.topics, activeTopicId)
    return doc.conversations
      .filter((c) => ids.has(c.topicId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [doc, activeTopicId])

  const selectTopic = (id: string): void => {
    setActiveTopicId(id)
    void persistUi({ lastTopicId: id })
  }

  const selectConversation = (id: string): void => {
    void loadConversation(id)
    void persistUi({ lastConversationId: id })
  }

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persistExpandedRef.current(next)
      return next
    })
  }

  useEffect(() => {
    if (!textDialog) return
    const id = window.setTimeout(() => {
      textDialogInputRef.current?.focus()
      textDialogInputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(id)
  }, [textDialog])

  const textDialogCancelRef = useRef<(() => void) | null>(null)
  const confirmDialogCancelRef = useRef<(() => void) | null>(null)

  const openTextDialog = (opts: {
    title: string
    initial?: string
    confirmLabel?: string
  }): Promise<string | null> =>
    new Promise((resolve) => {
      let settled = false
      const finish = (value: string | null): void => {
        if (settled) return
        settled = true
        textDialogCancelRef.current = null
        setTextDialog(null)
        resolve(value)
      }
      textDialogCancelRef.current = () => finish(null)
      setTextDialog({
        title: opts.title,
        initial: opts.initial ?? '',
        confirmLabel: opts.confirmLabel ?? 'OK',
        onConfirm: (value) => {
          const trimmed = value.trim()
          finish(trimmed ? trimmed : null)
        }
      })
      setTextDialogValue(opts.initial ?? '')
    })

  const openConfirmDialog = (opts: {
    message: string
    confirmLabel?: string
  }): Promise<boolean> =>
    new Promise((resolve) => {
      let settled = false
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        confirmDialogCancelRef.current = null
        setConfirmDialog(null)
        resolve(ok)
      }
      confirmDialogCancelRef.current = () => finish(false)
      setConfirmDialog({
        message: opts.message,
        confirmLabel: opts.confirmLabel ?? 'Remove',
        onConfirm: () => finish(true)
      })
    })

  const onNewRootTopic = async (): Promise<void> => {
    const name = await openTextDialog({ title: 'New folder', confirmLabel: 'Create' })
    if (!name) return
    try {
      const res = await call(api.aiChat.createTopic({ name, parentId: null }))
      await refreshSnapshot()
      selectTopic(res.topic.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onNewSubfolder = async (parentId: string): Promise<void> => {
    const name = await openTextDialog({ title: 'New subfolder', confirmLabel: 'Create' })
    if (!name) return
    try {
      const res = await call(api.aiChat.createTopic({ name, parentId }))
      setExpanded((prev) => {
        const next = new Set(prev).add(parentId)
        persistExpandedRef.current(next)
        return next
      })
      await refreshSnapshot()
      selectTopic(res.topic.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onRenameTopic = async (topic: AiChatTopic): Promise<void> => {
    const name = await openTextDialog({
      title: 'Rename folder',
      initial: topic.name,
      confirmLabel: 'Rename'
    })
    if (!name || name === topic.name) return
    try {
      await call(api.aiChat.renameTopic({ id: topic.id, name }))
      await refreshSnapshot()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onDeleteTopic = async (topic: AiChatTopic): Promise<void> => {
    const childCount = topics.filter((t) => t.parentId === topic.id).length
    const message =
      childCount > 0
        ? `Remove “${topic.name}” and its subfolders? Chats move to another folder.`
        : `Remove folder “${topic.name}”? Chats move to another folder.`
    const ok = await openConfirmDialog({ message, confirmLabel: 'Remove folder' })
    if (!ok) return
    try {
      await call(api.aiChat.deleteTopic({ id: topic.id }))
      const snap = await refreshSnapshot()
      if (
        activeTopicId === topic.id ||
        (activeTopicId && topicSubtreeIds(topics, topic.id).has(activeTopicId))
      ) {
        const nextId = snap.ui.lastTopicId ?? snap.topics[0]?.id ?? null
        setActiveTopicId(nextId)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const moveTopicRelative = async (topic: AiChatTopic, dir: 'up' | 'down'): Promise<void> => {
    const siblings = childrenOfTopic(topics, topic.parentId)
    const i = siblings.findIndex((t) => t.id === topic.id)
    if (i < 0) return
    const target = dir === 'up' ? siblings[i - 1] : siblings[i + 1]
    if (!target) return
    try {
      if (dir === 'up') {
        await call(
          api.aiChat.moveTopic({
            id: topic.id,
            parentId: topic.parentId,
            beforeId: target.id
          })
        )
      } else {
        await call(
          api.aiChat.moveTopic({
            id: target.id,
            parentId: topic.parentId,
            beforeId: topic.id
          })
        )
      }
      await refreshSnapshot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onTopicContextMenu = (e: ReactMouseEvent, topic: AiChatTopic): void => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ kind: 'topic', topic, x: e.clientX, y: e.clientY })
  }

  const onNewChat = async (): Promise<void> => {
    if (!activeTopicId) return
    try {
      const res = await call(
        api.aiChat.createConversation({ topicId: activeTopicId, title: 'New chat' })
      )
      await refreshSnapshot()
      setConversation(res.conversation)
      setActiveConversationId(res.conversation.id)
      setDraft('')
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onRenameConversation = async (c: AiChatConversation): Promise<void> => {
    const title = await openTextDialog({
      title: 'Rename conversation',
      initial: c.title,
      confirmLabel: 'Rename'
    })
    if (!title || title === c.title) return
    try {
      await call(api.aiChat.renameConversation({ id: c.id, title }))
      await refreshSnapshot()
      if (activeConversationId === c.id) {
        await loadConversation(c.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onDeleteConversation = async (id: string): Promise<void> => {
    const ok = await openConfirmDialog({
      message: 'Remove this conversation? This cannot be undone.',
      confirmLabel: 'Remove conversation'
    })
    if (!ok) return
    try {
      await call(api.aiChat.deleteConversation({ id }))
      const snap = await refreshSnapshot()
      if (activeConversationId === id) {
        const next = snap.conversations.find((c) => c.topicId === activeTopicId) ?? null
        await loadConversation(next?.id ?? null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const onChatContextMenu = (e: ReactMouseEvent, c: AiChatConversation): void => {
    e.preventDefault()
    setCtxMenu({ kind: 'chat', chat: c, x: e.clientX, y: e.clientY })
  }

  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    const onKey = (ev: globalThis.KeyboardEvent): void => {
      if (ev.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const ackCloud = async (): Promise<void> => {
    await call(api.settings.set({ ai: { acknowledgedCloudGenerate: true } }))
    const settings = await call(api.settings.get())
    useAppStore.setState({ settings })
    setCloudAckNeeded(false)
  }

  const send = async (): Promise<void> => {
    if (!activeConversationId || !draft.trim() || busy || cloudAckNeeded) return
    const content = draft.trim()
    setDraft('')
    setBusy(true)
    setError(null)
    try {
      const res = await call(
        api.aiChat.sendMessage({ conversationId: activeConversationId, content })
      )
      setConversation(res.conversation)
      await refreshSnapshot()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await loadConversation(activeConversationId)
    } finally {
      setBusy(false)
    }
  }

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const sidebarWidth = doc?.ui.sidebarWidthPx ?? 260
  const topicRatio = doc?.ui.topicPaneRatio ?? 0.45

  const onSidebarResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = sidebarWidth
    const latestRef = { current: startW }
    let ended = false
    const endDrag = (ev: PointerEvent): void => {
      if (ended) return
      ended = true
      if (target.hasPointerCapture(ev.pointerId)) {
        target.releasePointerCapture(ev.pointerId)
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      void persistUi({ sidebarWidthPx: latestRef.current })
    }
    const move = (ev: PointerEvent): void => {
      latestRef.current = Math.min(560, Math.max(180, startW + (ev.clientX - startX)))
      setDoc((d) =>
        d ? { ...d, ui: { ...d.ui, sidebarWidthPx: latestRef.current } } : d
      )
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  const onTopicSplitDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const splitEl = e.currentTarget
    const topicsEl = splitEl.previousElementSibling
    const chatsEl = splitEl.nextElementSibling
    if (!(topicsEl instanceof HTMLElement) || !(chatsEl instanceof HTMLElement)) return
    splitEl.setPointerCapture(e.pointerId)
    const latestRef = { current: topicRatio }
    let ended = false
    const ratioAt = (clientY: number): number => {
      const top = topicsEl.getBoundingClientRect().top
      const bottom = chatsEl.getBoundingClientRect().bottom
      const height = bottom - top
      if (height < 1) return latestRef.current
      return Math.min(0.75, Math.max(0.25, (clientY - top) / height))
    }
    const endDrag = (ev: PointerEvent): void => {
      if (ended) return
      ended = true
      if (splitEl.hasPointerCapture(ev.pointerId)) {
        splitEl.releasePointerCapture(ev.pointerId)
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', endDrag)
      window.removeEventListener('pointercancel', endDrag)
      void persistUi({ topicPaneRatio: latestRef.current })
    }
    const move = (ev: PointerEvent): void => {
      latestRef.current = ratioAt(ev.clientY)
      setDoc((d) =>
        d ? { ...d, ui: { ...d.ui, topicPaneRatio: latestRef.current } } : d
      )
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  const clearDropHighlight = (): void => {
    setTopicDrop(null)
    setDropRoot(false)
  }

  const topicDropEdge = (
    e: DragEvent,
    el: HTMLElement,
    draggingTopic: boolean
  ): 'before' | 'after' | 'into' => {
    if (!draggingTopic) return 'into'
    const rect = el.getBoundingClientRect()
    const y = e.clientY - rect.top
    const ratio = rect.height > 0 ? y / rect.height : 0.5
    if (ratio < 0.28) return 'before'
    if (ratio > 0.72) return 'after'
    return 'into'
  }

  const applyTopicDrop = async (
    target: AiChatTopic,
    mode: 'before' | 'after' | 'into',
    draggedId: string
  ): Promise<void> => {
    if (draggedId === target.id) return
    if (topicSubtreeIds(topics, draggedId).has(target.id)) return
    if (mode === 'into') {
      await call(api.aiChat.moveTopic({ id: draggedId, parentId: target.id }))
      setExpanded((prev) => {
        const next = new Set(prev).add(target.id)
        persistExpandedRef.current(next)
        return next
      })
      return
    }
    const parentId = target.parentId
    if (mode === 'before') {
      await call(
        api.aiChat.moveTopic({ id: draggedId, parentId, beforeId: target.id })
      )
      return
    }
    const siblings = childrenOfTopic(topics, parentId).filter((t) => t.id !== draggedId)
    const i = siblings.findIndex((t) => t.id === target.id)
    const next = i >= 0 ? siblings[i + 1] : undefined
    if (next) {
      await call(
        api.aiChat.moveTopic({ id: draggedId, parentId, beforeId: next.id })
      )
    } else {
      await call(api.aiChat.moveTopic({ id: draggedId, parentId }))
    }
  }

  const onDropOntoTopic = async (target: AiChatTopic, e: DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    const mode = topicDrop?.topicId === target.id ? topicDrop.mode : 'into'
    clearDropHighlight()
    setDraggingTopicId(null)
    const chatId = e.dataTransfer.getData(DND_CHAT)
    const topicId = e.dataTransfer.getData(DND_TOPIC)
    try {
      if (chatId) {
        await call(api.aiChat.moveConversation({ id: chatId, topicId: target.id }))
        await refreshSnapshot()
        return
      }
      if (topicId) {
        await applyTopicDrop(target, mode, topicId)
        await refreshSnapshot()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const onDropOntoRoot = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    clearDropHighlight()
    setDraggingTopicId(null)
    const topicId = e.dataTransfer.getData(DND_TOPIC)
    if (!topicId) return
    try {
      await call(api.aiChat.moveTopic({ id: topicId, parentId: null }))
      await refreshSnapshot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const renderTopicBranch = (parentId: string | null, depth: number): JSX.Element[] => {
    return childrenOfTopic(topics, parentId).map((t) => {
      const kids = childrenOfTopic(topics, t.id)
      const hasKids = kids.length > 0
      const isOpen = expanded.has(t.id)
      const dropHere = topicDrop?.topicId === t.id ? topicDrop.mode : null
      return (
        <div key={t.id} className="ai-chat-topic-block">
          <div
            className={[
              'ai-chat-topic-row',
              t.id === activeTopicId ? 'active' : '',
              dropHere === 'into' ? 'drop-into' : '',
              dropHere === 'before' ? 'drop-before' : '',
              dropHere === 'after' ? 'drop-after' : '',
              draggingTopicId === t.id ? 'dragging' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: 6 + depth * 14 }}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(DND_TOPIC, t.id)
              e.dataTransfer.setData('text/plain', t.id)
              setDraggingTopicId(t.id)
            }}
            onDragEnd={() => {
              setDraggingTopicId(null)
              clearDropHighlight()
            }}
            onDragOver={(e) => {
              const types = [...e.dataTransfer.types]
              const isChat = types.includes(DND_CHAT)
              const isTopic = types.includes(DND_TOPIC)
              if (!isChat && !isTopic && !types.includes('text/plain')) return
              if (draggingTopicId === t.id) return
              if (draggingTopicId && topicSubtreeIds(topics, draggingTopicId).has(t.id)) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = 'move'
              const mode = topicDropEdge(e, e.currentTarget, Boolean(draggingTopicId) || isTopic)
              setTopicDrop({ topicId: t.id, mode: isChat ? 'into' : mode })
              setDropRoot(false)
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setTopicDrop((cur) => (cur?.topicId === t.id ? null : cur))
            }}
            onDrop={(e) => void onDropOntoTopic(t, e)}
            onContextMenu={(e) => onTopicContextMenu(e, t)}
          >
            <button
              type="button"
              className="ai-chat-topic-twist"
              aria-label={hasKids ? (isOpen ? 'Collapse' : 'Expand') : 'No subfolders'}
              disabled={!hasKids}
              onClick={(e) => {
                e.stopPropagation()
                if (hasKids) toggleExpanded(t.id)
              }}
            >
              {hasKids ? (isOpen ? <ChevronDown /> : <ChevronRight />) : (
                <span className="ai-chat-topic-twist-spacer" />
              )}
            </button>
            <button
              type="button"
              className="ai-chat-topic-item"
              onClick={() => {
                selectTopic(t.id)
                if (hasKids && !isOpen) toggleExpanded(t.id)
              }}
              onDoubleClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void onRenameTopic(t)
              }}
              title="Double-click to rename · Drag edges to reorder · Center to nest"
            >
              <FolderIcon size={14} className="ai-chat-topic-folder" />
              <span className="ai-chat-topic-name">{t.name}</span>
            </button>
            <button
              type="button"
              className="ai-chat-row-action"
              title="Rename folder"
              aria-label={`Rename folder ${t.name}`}
              onClick={(e) => {
                e.stopPropagation()
                void onRenameTopic(t)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <EditImageIcon size={12} />
            </button>
            <button
              type="button"
              className="ai-chat-row-action"
              title="Remove folder"
              aria-label={`Remove folder ${t.name}`}
              onClick={(e) => {
                e.stopPropagation()
                void onDeleteTopic(t)
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <CloseIcon size={12} />
            </button>
          </div>
          {hasKids && isOpen ? renderTopicBranch(t.id, depth + 1) : null}
        </div>
      )
    })
  }

  if (!doc) {
    return (
      <div className="ai-chat">
        <div className="ai-chat-empty">{error ?? 'Loading Ask AI…'}</div>
      </div>
    )
  }

  return (
    <div className="ai-chat">
      <aside className="ai-chat-sidebar" style={{ width: sidebarWidth }}>
        <div className="ai-chat-topics" style={{ flex: `${topicRatio} 1 0` }}>
          <div className="ai-chat-pane-header">
            <span>Folders</span>
            <button type="button" className="btn" onClick={() => void onNewRootTopic()}>
              New
            </button>
          </div>
          <div
            className={`ai-chat-topic-tree${dropRoot ? ' drop-root' : ''}`}
            onDragOver={(e) => {
              if (![...e.dataTransfer.types].includes(DND_TOPIC)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropRoot(true)
              setTopicDrop(null)
            }}
            onDragLeave={() => setDropRoot(false)}
            onDrop={(e) => void onDropOntoRoot(e)}
          >
            {renderTopicBranch(null, 0)}
            {topics.length === 0 ? <div className="ai-chat-dim">No folders</div> : null}
          </div>
        </div>
        <div className="ai-chat-split-h" onPointerDown={onTopicSplitDrag} role="separator" />
        <div className="ai-chat-chats" style={{ flex: `${1 - topicRatio} 1 0` }}>
          <div className="ai-chat-pane-header">
            <span>Chats</span>
            <button type="button" className="btn" onClick={() => void onNewChat()} disabled={!activeTopicId}>
              New
            </button>
          </div>
          <ul className="ai-chat-chat-list">
            {conversations.map((c) => (
              <li
                key={c.id}
                className={`ai-chat-chat-row${c.id === activeConversationId ? ' active' : ''}`}
              >
                <button
                  type="button"
                  className="ai-chat-chat-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData(DND_CHAT, c.id)
                    e.dataTransfer.setData('text/plain', c.id)
                  }}
                  onClick={() => selectConversation(c.id)}
                  onDoubleClick={(e) => {
                    e.preventDefault()
                    void onRenameConversation(c)
                  }}
                  onContextMenu={(e) => onChatContextMenu(e, c)}
                  title={
                    c.starter?.label
                      ? `${c.title} · ${c.starter.label} — double-click to rename`
                      : 'Double-click to rename · Drag onto a folder to move'
                  }
                >
                  <span className="ai-chat-chat-title">{c.title}</span>
                  {c.starter?.label ? (
                    <span className="ai-chat-chat-meta">{c.starter.label}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="ai-chat-row-action"
                  title="Rename conversation"
                  aria-label={`Rename conversation ${c.title}`}
                  onClick={() => void onRenameConversation(c)}
                >
                  <EditImageIcon size={12} />
                </button>
                <button
                  type="button"
                  className="ai-chat-row-action"
                  title="Remove conversation"
                  aria-label={`Remove conversation ${c.title}`}
                  onClick={() => void onDeleteConversation(c.id)}
                >
                  <CloseIcon size={12} />
                </button>
              </li>
            ))}
          </ul>
          {conversations.length === 0 ? (
            <div className="ai-chat-dim">No conversations in this folder</div>
          ) : null}
        </div>
      </aside>
      <div className="ai-chat-sidebar-resizer" onPointerDown={onSidebarResize} role="separator" />
      <main className="ai-chat-main">
        <header className="ai-chat-main-header">
          <div className="ai-chat-main-title-row">
            <button
              type="button"
              className="ai-chat-main-title"
              disabled={!conversation}
              title={conversation ? 'Double-click or click pencil to rename' : undefined}
              onDoubleClick={() => {
                if (conversation) void onRenameConversation(conversation)
              }}
            >
              {conversation?.title ?? 'Ask AI'}
              {conversation?.starter?.label ? (
                <span className="ai-chat-chat-meta"> · {conversation.starter.label}</span>
              ) : null}
            </button>
            {conversation ? (
              <button
                type="button"
                className="ai-chat-row-action ai-chat-row-action-always"
                title="Rename conversation"
                aria-label="Rename conversation"
                onClick={() => void onRenameConversation(conversation)}
              >
                <EditImageIcon size={14} />
              </button>
            ) : null}
          </div>
          {conversation?.sourceContext ? (
            <div className="ai-chat-source-context" title="Context supplied by MyFileExplorer">
              {conversation.sourceContext.glyph === 'document' ||
              conversation.sourceContext.glyph === 'file' ? (
                <FileIcon size={14} className="ai-chat-source-glyph" />
              ) : (
                <VideoFileIcon size={14} className="ai-chat-source-glyph" />
              )}
              <span className="ai-chat-source-title">{conversation.sourceContext.title}</span>
              {conversation.sourceContext.detail ? (
                <span className="ai-chat-source-detail">{conversation.sourceContext.detail}</span>
              ) : null}
            </div>
          ) : null}
        </header>
        {cloudAckNeeded ? (
          <div className="ai-chat-banner" role="status">
            <p>
              Cloud AI may receive conversation text (media titles / questions). It never receives
              your files or folder paths. Continue to acknowledge.
            </p>
            <button type="button" className="btn primary" onClick={() => void ackCloud()}>
              Continue
            </button>
          </div>
        ) : null}
        <div className="ai-chat-thread" ref={threadRef}>
          {!conversation ? (
            <div className="ai-chat-empty">
              Select a conversation or start one from Media Metadata → Ask AI…
            </div>
          ) : (
            conversation.messages
              .filter((m) => m.role !== 'system')
              .map((m) => (
                <div key={m.id} className={`ai-chat-bubble ai-chat-bubble-${m.role}`}>
                  <div className="ai-chat-bubble-role">{m.role === 'user' ? 'You' : 'AI'}</div>
                  {m.role === 'assistant' ? (
                    <div
                      className="ai-chat-md"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                    />
                  ) : (
                    <div className="ai-chat-user-text">{m.content}</div>
                  )}
                </div>
              ))
          )}
          {busy ? <div className="ai-chat-dim">Thinking…</div> : null}
          {error ? <div className="ai-chat-error">{error}</div> : null}
        </div>
        <footer className="ai-chat-composer">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onComposerKey}
            placeholder={
              conversation
                ? 'Follow up… (Enter to send, Shift+Enter for newline)'
                : 'Select or create a chat first'
            }
            disabled={!conversation || busy || cloudAckNeeded}
            rows={3}
          />
          <button
            type="button"
            className="btn primary"
            disabled={!conversation || busy || cloudAckNeeded || !draft.trim()}
            onClick={() => void send()}
          >
            Send
          </button>
        </footer>
      </main>
      {ctxMenu ? (
        <div
          className="ai-chat-ctx"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          role="menu"
        >
          {ctxMenu.kind === 'topic' ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const t = ctxMenu.topic
                  setCtxMenu(null)
                  void onNewSubfolder(t.id)
                }}
              >
                New subfolder
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const t = ctxMenu.topic
                  setCtxMenu(null)
                  void onRenameTopic(t)
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={
                  childrenOfTopic(topics, ctxMenu.topic.parentId).findIndex(
                    (s) => s.id === ctxMenu.topic.id
                  ) <= 0
                }
                onClick={() => {
                  const t = ctxMenu.topic
                  setCtxMenu(null)
                  void moveTopicRelative(t, 'up')
                }}
              >
                Move up
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={(() => {
                  const sibs = childrenOfTopic(topics, ctxMenu.topic.parentId)
                  const i = sibs.findIndex((s) => s.id === ctxMenu.topic.id)
                  return i < 0 || i >= sibs.length - 1
                })()}
                onClick={() => {
                  const t = ctxMenu.topic
                  setCtxMenu(null)
                  void moveTopicRelative(t, 'down')
                }}
              >
                Move down
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={ctxMenu.topic.parentId === null}
                onClick={() => {
                  const t = ctxMenu.topic
                  setCtxMenu(null)
                  void (async () => {
                    try {
                      await call(api.aiChat.moveTopic({ id: t.id, parentId: null }))
                      await refreshSnapshot()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    }
                  })()
                }}
              >
                Move to root
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  const t = ctxMenu.topic
                  setCtxMenu(null)
                  void onDeleteTopic(t)
                }}
              >
                Remove folder
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const c = ctxMenu.chat
                  setCtxMenu(null)
                  void onRenameConversation(c)
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  const c = ctxMenu.chat
                  setCtxMenu(null)
                  void onDeleteConversation(c.id)
                }}
              >
                Remove conversation
              </button>
            </>
          )}
        </div>
      ) : null}
      {textDialog ? (
        <div
          className="ai-chat-modal-backdrop"
          onPointerDown={() => textDialogCancelRef.current?.()}
        >
          <div
            className="ai-chat-modal"
            role="dialog"
            aria-label={textDialog.title}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="ai-chat-modal-title">{textDialog.title}</div>
            <input
              ref={textDialogInputRef}
              className="ai-chat-modal-input"
              value={textDialogValue}
              onChange={(e) => setTextDialogValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  textDialog.onConfirm(textDialogValue)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  textDialogCancelRef.current?.()
                }
              }}
            />
            <div className="ai-chat-modal-actions">
              <button type="button" className="btn" onClick={() => textDialogCancelRef.current?.()}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={!textDialogValue.trim()}
                onClick={() => textDialog.onConfirm(textDialogValue)}
              >
                {textDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmDialog ? (
        <div
          className="ai-chat-modal-backdrop"
          onPointerDown={() => confirmDialogCancelRef.current?.()}
        >
          <div
            className="ai-chat-modal"
            role="dialog"
            aria-label="Confirm"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="ai-chat-modal-title">{confirmDialog.message}</div>
            <div className="ai-chat-modal-actions">
              <button
                type="button"
                className="btn"
                onClick={() => confirmDialogCancelRef.current?.()}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => confirmDialog.onConfirm()}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
