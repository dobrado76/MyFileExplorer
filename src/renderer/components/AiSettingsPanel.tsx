import { useEffect, useState, type JSX } from 'react'
import {
  DEFAULT_AI_BASE_URLS,
  providerLooksLocal,
  type AiProviderProfile,
  type AiProviderType
} from '@shared/schemas/ai'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { AiModelSelect, useAiProviderModels } from './AiModelSelect'
import { formatError } from './scriptUi'

const TYPES: AiProviderType[] = ['openai', 'openrouter', 'lmstudio', 'custom']

export function AiSettingsPanel(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const applySettingsPatch = useAppStore((s) => s.applySettingsPatch)
  const notify = useAppStore((s) => s.notify)
  const ai = settings.ai

  const [providers, setProviders] = useState<Array<AiProviderProfile & { hasApiKey: boolean }>>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [type, setType] = useState<AiProviderType>('lmstudio')
  const [baseUrl, setBaseUrl] = useState(DEFAULT_AI_BASE_URLS.lmstudio)
  const [model, setModel] = useState('')
  const [local, setLocal] = useState(true)
  const [timeoutSec, setTimeoutSec] = useState(60)
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<string | null>(null)
  const [modelRefresh, setModelRefresh] = useState(0)

  const reload = (): void => {
    void call(api.ai.listProviders())
      .then((r) => setProviders(r.providers))
      .catch((e) => setStatus(formatError(e)))
  }

  useEffect(() => {
    reload()
  }, [])

  const defaultCached =
    providers.find((p) => p.id === ai.defaultProviderId)?.cachedModels ??
    settings.ai.providers.find((p) => p.id === ai.defaultProviderId)?.cachedModels ??
    []
  const editCached =
    providers.find((p) => p.id === editId)?.cachedModels ??
    settings.ai.providers.find((p) => p.id === editId)?.cachedModels ??
    []
  const defaultModels = useAiProviderModels(
    ai.defaultProviderId || undefined,
    ai.enabled,
    defaultCached
  )
  const editorModels = useAiProviderModels(editId ?? undefined, ai.enabled, editCached, modelRefresh)

  useEffect(() => {
    if (modelRefresh === 0 || editorModels.loading) return
    if (editorModels.error) {
      setStatus(editorModels.error)
      return
    }
    setStatus(
      editorModels.models.length > 0
        ? `${editorModels.models.length} models`
        : 'No models returned'
    )
  }, [modelRefresh, editorModels.loading, editorModels.models.length, editorModels.error])

  const blank = (t: AiProviderType = 'lmstudio'): void => {
    setEditId(null)
    setName(t === 'lmstudio' ? 'LM Studio' : t === 'openai' ? 'OpenAI' : t === 'openrouter' ? 'OpenRouter' : 'Custom')
    setType(t)
    setBaseUrl(DEFAULT_AI_BASE_URLS[t])
    setModel('')
    setLocal(providerLooksLocal(t, DEFAULT_AI_BASE_URLS[t]))
    setTimeoutSec(60)
    setApiKey('')
  }

  const saveProvider = async (): Promise<void> => {
    try {
      const previousId = editId
      const res = await call(
        api.ai.upsertProvider({
          id: editId ?? undefined,
          name,
          type,
          baseUrl,
          model,
          local,
          timeoutSec,
          apiKey: apiKey.trim() ? apiKey.trim() : undefined
        })
      )
      setEditId(res.provider.id)
      setApiKey('')
      const next = await call(api.settings.get())
      useAppStore.setState({ settings: next })
      reload()
      if (previousId === res.provider.id) setModelRefresh((n) => n + 1)
      notify('Provider saved')
    } catch (e) {
      setStatus(formatError(e))
    }
  }

  const scriptingOn = settings.scripts.enabled

  return (
    <div className="settings-stack">
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={scriptingOn}
          onChange={(e) => void applySettingsPatch({ scripts: { enabled: e.target.checked } })}
        />
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Enable scripting</span>
          <span className="settings-toggle-hint">
            Off by default. On: Script Manager on the toolbar and Scripts on the context menu.
            Scripts run as your Windows user and can change or delete files.
          </span>
        </span>
      </label>
      {!scriptingOn ? (
        <p className="settings-field-hint">
          This is an advanced feature. A first install stays a plain file manager until you turn
          scripting on.
        </p>
      ) : null}

      {scriptingOn ? (
        <>
      <h3>Script runner</h3>
      <p className="settings-field-hint">
        Optional interpreter paths when PATH is not enough. Python must be <strong>3.x</strong> —
        Python 2.7 is not supported (`print(…, file=sys.stderr)` will SyntaxError).
      </p>
      {(['powershell', 'pwsh', 'python', 'cmd', 'bash'] as const).map((k) => (
        <label key={k} className="settings-field">
          <span>{k}</span>
          <input
            value={settings.scripts.interpreterOverrides[k] ?? ''}
            onChange={(e) =>
              void applySettingsPatch({
                scripts: {
                  interpreterOverrides: {
                    ...settings.scripts.interpreterOverrides,
                    [k]: e.target.value
                  }
                }
              })
            }
          />
        </label>
      ))}

      <h3>AI (optional)</h3>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={ai.enabled}
          onChange={(e) => void applySettingsPatch({ ai: { enabled: e.target.checked } })}
        />
        <span className="settings-toggle-text">
          <span className="settings-toggle-label">Enable AI</span>
          <span className="settings-toggle-hint">
            Off = no outbound AI HTTP. Hand-written scripts still run locally.
          </span>
        </span>
      </label>
      <p className="settings-field-hint">
        AI may write scripts. It never receives file names, paths, folder listings, or file bytes.
        API keys are stored with OS encryption (safeStorage), not in settings.json. Settings export
        includes provider URLs and models, not keys.
      </p>
      <label className="settings-field">
        <span>Default provider</span>
        <select
          value={ai.defaultProviderId}
          onChange={(e) => void applySettingsPatch({ ai: { defaultProviderId: e.target.value } })}
        >
          <option value="">None</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Default model</span>
        <AiModelSelect
          value={ai.defaultModel}
          models={defaultModels.models}
          loading={defaultModels.loading}
          disabled={!ai.defaultProviderId}
          emptyHint={
            ai.defaultProviderId
              ? 'Refresh models after saving a key'
              : 'Pick a default provider first'
          }
          onChange={(next) => void applySettingsPatch({ ai: { defaultModel: next } })}
        />
      </label>
      <p className="settings-field-hint">
        Models come from the default provider’s catalog (GET /v1/models). Switch to a cheaper id
        whenever you want — the list is cached after the first refresh.
      </p>
      <label className="settings-field">
        <span>Preferred script language</span>
        <select
          value={ai.preferredScriptLanguage}
          onChange={(e) =>
            void applySettingsPatch({
              ai: { preferredScriptLanguage: e.target.value as typeof ai.preferredScriptLanguage }
            })
          }
        >
          <option value="auto">Auto</option>
          <option value="powershell">PowerShell</option>
          <option value="python">Python</option>
          <option value="cmd">cmd</option>
          <option value="bash">bash</option>
        </select>
      </label>
      <label className="settings-field">
        <span>Temperature</span>
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={ai.temperature}
          onChange={(e) =>
            void applySettingsPatch({ ai: { temperature: Number(e.target.value) } })
          }
        />
      </label>
      <label className="settings-field">
        <span>Max tokens</span>
        <input
          type="number"
          min={256}
          max={32768}
          value={ai.maxOutputTokens}
          onChange={(e) =>
            void applySettingsPatch({ ai: { maxOutputTokens: Number(e.target.value) } })
          }
        />
      </label>
      <h3>Providers</h3>
      <ul className="script-provider-list">
        {providers.map((p) => (
          <li key={p.id}>
            <button type="button" className="btn" onClick={() => {
              setEditId(p.id)
              setName(p.name)
              setType(p.type)
              setBaseUrl(p.baseUrl)
              setModel(p.model)
              setLocal(p.local)
              setTimeoutSec(p.timeoutSec)
              setApiKey('')
            }}>
              {p.name}
            </button>
            <span className="dim">
              {p.type}
              {p.local ? ' · local' : ' · cloud'}
              {p.hasApiKey ? ' · key saved' : ''}
            </span>
          </li>
        ))}
      </ul>
      <div className="script-check-row">
        {TYPES.map((t) => (
          <button type="button" key={t} className="btn" onClick={() => blank(t)}>
            Add {t}
          </button>
        ))}
      </div>
      <div className="script-meta-grid">
        <label className="settings-field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="settings-field">
          <span>Type</span>
          <select
            value={type}
            onChange={(e) => {
              const t = e.target.value as AiProviderType
              setType(t)
              setBaseUrl(DEFAULT_AI_BASE_URLS[t])
              setLocal(providerLooksLocal(t, DEFAULT_AI_BASE_URLS[t]))
            }}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field script-meta-wide">
          <span>Base URL</span>
          <input value={baseUrl} onChange={(e) => {
            setBaseUrl(e.target.value)
            setLocal(providerLooksLocal(type, e.target.value))
          }} />
        </label>
        <label className="settings-field">
          <span>Model</span>
          <AiModelSelect
            value={model}
            models={editorModels.models}
            loading={editorModels.loading}
            disabled={!editId}
            emptyHint={editId ? 'Refresh models after saving a key' : 'Save the provider first'}
            onChange={setModel}
          />
        </label>
        <label className="settings-field">
          <span>Timeout (sec)</span>
          <input
            type="number"
            min={5}
            max={600}
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(Number(e.target.value) || 60)}
          />
        </label>
        <label className="settings-field">
          <span>API key</span>
          <input
            type="password"
            value={apiKey}
            placeholder={editId ? 'unchanged unless typed' : ''}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />
          <span>Treat as local (no cloud first-use warning)</span>
        </label>
      </div>
      <div className="script-check-row">
        <button type="button" className="btn primary" onClick={() => void saveProvider()}>
          Save provider
        </button>
        <button
          type="button"
          className="btn"
          disabled={!editId}
          onClick={() => {
            if (!editId) return
            void call(api.ai.testConnection({ id: editId }))
              .then(async (r) => {
                setStatus(r.message)
                const next = await call(api.settings.get())
                useAppStore.setState({ settings: next })
                reload()
              })
              .catch((e) => setStatus(formatError(e)))
          }}
        >
          Test
        </button>
        <button
          type="button"
          className="btn"
          disabled={!editId}
          onClick={() => {
            if (!editId) return
            setModelRefresh((n) => n + 1)
            setStatus('Refreshing models…')
          }}
        >
          Refresh models
        </button>
        <button
          type="button"
          className="btn"
          disabled={!editId}
          onClick={() => {
            if (!editId) return
            const src = providers.find((p) => p.id === editId)
            if (!src) return
            setEditId(null)
            setName(`${src.name} copy`)
            setApiKey('')
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={!editId}
          onClick={() => {
            if (!editId) return
            if (!window.confirm('Delete this provider?')) return
            void call(api.ai.deleteProvider({ id: editId })).then(async () => {
              blank()
              const next = await call(api.settings.get())
              useAppStore.setState({ settings: next })
              reload()
            })
          }}
        >
          Delete
        </button>
      </div>
      {status && <div className="settings-field-hint">{status}</div>}
        </>
      ) : null}
    </div>
  )
}
