import { useEffect, useMemo, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { formatError } from './scriptUi'

export function useAiProviderModels(
  providerId: string | undefined,
  enabled: boolean,
  cached: string[] = [],
  refreshNonce = 0
): { models: string[]; loading: boolean; error: string | null } {
  const [models, setModels] = useState<string[]>(cached)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setModels(cached)
    setError(null)
    if (!providerId || !enabled) return
    let cancelled = false
    setLoading(true)
    void call(api.ai.listModels({ id: providerId }))
      .then(async (r) => {
        if (cancelled) return
        setModels(r.models.map((m) => m.id))
        const next = await call(api.settings.get())
        if (!cancelled) useAppStore.setState({ settings: next })
      })
      .catch((e) => {
        if (cancelled) return
        if (cached.length) setModels(cached)
        setError(formatError(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // cached is the last successful list; do not refetch when it updates from this same call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, enabled, refreshNonce])

  return { models: models.length > 0 ? models : cached, loading, error }
}

export function AiModelSelect({
  value,
  models,
  onChange,
  disabled,
  loading,
  emptyHint
}: {
  value: string
  models: string[]
  onChange(next: string): void
  disabled?: boolean
  loading?: boolean
  emptyHint?: string
}): JSX.Element {
  const [filter, setFilter] = useState('')
  const options = useMemo(() => {
    const uniq = [...new Set(models.filter(Boolean))]
    if (value && !uniq.includes(value)) return [value, ...uniq]
    return uniq
  }, [models, value])
  const q = filter.trim().toLowerCase()
  const shown = q ? options.filter((id) => id.toLowerCase().includes(q)) : options
  const long = options.length > 24

  if (options.length === 0 && !loading) {
    return (
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={emptyHint ?? 'Save the provider, then Refresh models'}
      />
    )
  }

  return (
    <div className="ai-model-select">
      {long && (
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter models"
          disabled={disabled}
        />
      )}
      <select
        value={value}
        disabled={disabled || loading}
        onChange={(e) => onChange(e.target.value)}
      >
        {!value && (
          <option value="">{loading ? 'Loading models…' : emptyHint ?? 'Select a model'}</option>
        )}
        {value && !shown.includes(value) && <option value={value}>{value}</option>}
        {shown.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </div>
  )
}
