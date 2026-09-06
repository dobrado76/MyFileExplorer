import type { AiChatTopic } from './schemas/aiChat'

/** Topics under `topicId`, including nested children (depth-first). */
export function topicSubtreeIds(topics: AiChatTopic[], topicId: string): Set<string> {
  const ids = new Set<string>([topicId])
  let grew = true
  while (grew) {
    grew = false
    for (const t of topics) {
      if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) {
        ids.add(t.id)
        grew = true
      }
    }
  }
  return ids
}

export function sortTopicsForTree(topics: AiChatTopic[]): AiChatTopic[] {
  return [...topics].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export function childrenOfTopic(topics: AiChatTopic[], parentId: string | null): AiChatTopic[] {
  return sortTopicsForTree(topics.filter((t) => t.parentId === parentId))
}

export function ancestorTopicIds(topics: AiChatTopic[], topicId: string): string[] {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const out: string[] = []
  let cur = byId.get(topicId)
  while (cur?.parentId) {
    out.push(cur.parentId)
    cur = byId.get(cur.parentId)
  }
  return out
}

/** Restore folder tree expand/collapse from persisted ids (drops stale ids). */
export function expandedTopicsFromUi(
  topics: AiChatTopic[],
  savedIds: string[] | undefined,
  lastTopicId: string | null
): Set<string> {
  const valid = new Set(topics.map((t) => t.id))
  const open = new Set<string>()
  if (savedIds?.length) {
    for (const id of savedIds) {
      if (valid.has(id)) open.add(id)
    }
    return open
  }
  for (const t of topics) {
    if (t.parentId === null) open.add(t.id)
  }
  if (lastTopicId && valid.has(lastTopicId)) {
    open.add(lastTopicId)
    for (const id of ancestorTopicIds(topics, lastTopicId)) {
      if (valid.has(id)) open.add(id)
    }
  }
  return open
}
