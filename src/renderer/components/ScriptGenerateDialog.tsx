import { useEffect, useState, type JSX } from 'react'
import type { ScriptLanguage } from '@shared/schemas/scripts'
import type { AiProviderProfile } from '@shared/schemas/ai'
import { looksDestructive } from '@shared/scriptDestructive'
import { useAppStore } from '../store/appStore'
import { AiModelSelect, useAiProviderModels } from './AiModelSelect'
import {
  CopyInstall,
  DestructiveBanner,
  RiskBanner,
  ScriptModal,
  SourceEditor,
  api,
  call,
  formatError
} from './scriptUi'

export function ScriptGenerateDialog(props: {
  mode?: 'folder' | 'selection'
  folderPath?: string
  scriptId?: string
  source?: string
  language?: ScriptLanguage
}): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const openDialog = useAppStore((s) => s.openDialog)
  const notify = useAppStore((s) => s.notify)
  const refresh = useAppStore((s) => s.refreshScriptLibrary)
  const settings = useAppStore((s) => s.settings)
  const selected = useAppStore((s) => s.activeTab().selected)

  const [providers, setProviders] = useState<Array<AiProviderProfile & { hasApiKey: boolean }>>([])
  const [providerId, setProviderId] = useState(settings.ai.defaultProviderId)
  const [model, setModel] = useState(settings.ai.defaultModel)
  const [task, setTask] = useState('')
  const [instruction, setInstruction] = useState('')
  const [language, setLanguage] = useState<'auto' | ScriptLanguage>(
    props.language ?? settings.ai.preferredScriptLanguage
  )
  const [target, setTarget] = useState<'folder' | 'selection'>(
    props.mode ?? (selected.length > 0 ? 'selection' : 'folder')
  )
  const [recursive, setRecursive] = useState(false)
  const [name, setName] = useState('Generated script')
  const [description, setDescription] = useState('')
  const [source, setSource] = useState(props.source ?? '')
  const [destructive, setDestructive] = useState(false)
  const [dryRunSupported, setDryRunSupported] = useState(false)
  const [dependencies, setDependencies] = useState<string[]>([])
  const [busy, setBusy] = useState<null | 'generate' | 'modify'>(null)
  const [error, setError] = useState<string | null>(null)
  const [cloudAck, setCloudAck] = useState(settings.ai.acknowledgedCloudGenerate)

  const provider = providers.find((p) => p.id === providerId)
  const isLocal = provider?.local ?? false
  const cachedModels =
    settings.ai.providers.find((p) => p.id === providerId)?.cachedModels ??
    provider?.cachedModels ??
    []
  const listed = useAiProviderModels(providerId || undefined, settings.ai.enabled, cachedModels)

  useEffect(() => {
    void call(api.ai.listProviders())
      .then((r) => {
        setProviders(r.providers)
        setProviderId((cur) => cur || r.providers[0]?.id || '')
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const p = providers.find((x) => x.id === providerId)
    if (!p) return
    const defaults = useAppStore.getState().settings.ai
    const next =
      p.model ||
      (p.id === defaults.defaultProviderId ? defaults.defaultModel : '') ||
      p.cachedModels[0] ||
      ''
    setModel(next)
  }, [providerId, providers])

  if (!settings.ai.enabled || providers.length === 0) {
    return (
      <ScriptModal
        title="Generate script with AI"
        onClose={closeDialog}
        actions={
          <>
            <button
              type="button"
              className="btn primary"
              title="Enable AI and add a provider. Hand-written scripts still run from Script Manager without AI."
              onClick={() => {
                closeDialog()
                openDialog({ kind: 'settings', section: 'ai' })
              }}
            >
              Open AI Settings
            </button>
            <button type="button" className="btn" title="Close this dialog." onClick={closeDialog}>
              Close
            </button>
          </>
        }
      >
        <p>
          AI is off or no provider is configured. The Script Runner still works with hand-written
          scripts — open Script Manager to write one, or enable AI to generate.
        </p>
      </ScriptModal>
    )
  }

  const applyGenerated = (g: {
    name: string
    description: string
    language: ScriptLanguage
    destructive: boolean
    dryRunSupported: boolean
    dependencies: string[]
    source: string
  }): void => {
    setName(g.name)
    setDescription(g.description)
    setLanguage(g.language)
    setDestructive(g.destructive || looksDestructive(g.source))
    setDryRunSupported(g.dryRunSupported)
    setDependencies(g.dependencies)
    setSource(g.source)
  }

  const generate = async (): Promise<void> => {
    if (!task.trim()) {
      setError('Describe the task first.')
      return
    }
    if (!isLocal && !cloudAck) {
      setError('Acknowledge that the task text may be sent to a cloud provider.')
      return
    }
    setBusy('generate')
    setError(null)
    try {
      if (!isLocal && !settings.ai.acknowledgedCloudGenerate) {
        await call(api.settings.set({ ai: { acknowledgedCloudGenerate: true } }))
      }
      const res = await call(
        api.ai.generate({
          task: task.trim(),
          language,
          target,
          recursive,
          providerId,
          model: model || undefined
        })
      )
      applyGenerated(res.script)
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusy(null)
    }
  }

  const modify = async (): Promise<void> => {
    if (!source.trim() || !instruction.trim()) {
      setError('Need current source and an instruction.')
      return
    }
    setBusy('modify')
    setError(null)
    try {
      const res = await call(
        api.ai.modify({
          source,
          instruction: instruction.trim(),
          language: language === 'auto' ? undefined : language,
          providerId,
          model: model || undefined
        })
      )
      applyGenerated(res.script)
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<string | null> => {
    if (!source.trim()) {
      setError('Nothing to save yet.')
      return null
    }
    try {
      const res = await call(
        api.script.upsert({
          script: {
            id: props.scriptId,
            name,
            description,
            language: language === 'auto' ? 'powershell' : language,
            interpreter: 'auto',
            scopes: [target],
            recursive,
            parameters: [],
            contextMenuEnabled: true,
            destructive,
            dryRunSupported,
            sourceKind: 'managed',
            dependencies
          },
          source,
          backupPrevious: !!props.scriptId
        })
      )
      await refresh()
      notify('Script saved — reruns locally with no AI')
      return res.script.id
    } catch (e) {
      setError(formatError(e))
      return null
    }
  }

  return (
    <ScriptModal
      className="modal-script-generate"
      title="Generate script with AI"
      onClose={closeDialog}
      busy={!!busy}
      busyTitle={busy === 'modify' ? 'Modifying…' : 'Generating…'}
      busyHint="This may take some time."
      actions={
        <>
          <button
            type="button"
            className="btn"
            title="Send the task description to AI and replace the editor with a new draft. File names and paths are never sent."
            disabled={!!busy}
            onClick={() => void generate()}
          >
            {source ? 'Regenerate' : 'Generate'}
          </button>
          <button
            type="button"
            className="btn"
            title="Send the current source plus the modify instruction. Only text — not your files."
            disabled={!!busy || !source}
            onClick={() => void modify()}
          >
            Modify
          </button>
          <button
            type="button"
            className="btn"
            title="Save into the script library. Later runs are local with no AI."
            disabled={!!busy || !source}
            onClick={() => void save()}
          >
            Save
          </button>
          {dryRunSupported && (
            <button
              type="button"
              className="btn"
              title="Save, then run with --dry-run if the script supports a preview pass."
              disabled={!!busy || !source}
              onClick={() => {
                void save().then((id) => {
                  if (!id) return
                  closeDialog()
                  openDialog({
                    kind: 'script-run',
                    scriptId: id,
                    name,
                    mode: target,
                    root: props.folderPath,
                    paths: selected,
                    recursive,
                    dryRun: true
                  })
                })
              }}
            >
              Dry run
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            title="Save to the library, then execute as you on the current folder or selection."
            disabled={!!busy || !source}
            onClick={() => {
              void save().then((id) => {
                if (!id) return
                closeDialog()
                openDialog({
                  kind: 'script-run',
                  scriptId: id,
                  name,
                  mode: target,
                  root: props.folderPath,
                  paths: selected,
                  recursive,
                  dryRun: false
                })
              })
            }}
          >
            Save & run
          </button>
          <button
            type="button"
            className="btn"
            title="Close without saving. Unsaved generated source is discarded."
            disabled={!!busy}
            onClick={closeDialog}
          >
            Close
          </button>
        </>
      }
    >
      <RiskBanner />
      <div className={`script-banner ${isLocal ? '' : 'script-banner-warn'}`}>
        {isLocal
          ? 'Local provider — requests stay on this machine.'
          : 'Cloud provider — the task text and generated/modified source may be sent. File names, paths, listings, and file bytes are never sent.'}
      </div>
      {!isLocal && !cloudAck && (
        <label className="settings-toggle">
          <input type="checkbox" checked={cloudAck} onChange={(e) => setCloudAck(e.target.checked)} />
          <span>I understand the task/script may go to this provider; my files do not.</span>
        </label>
      )}
      <div className="script-meta-grid">
        <label
          className="settings-field"
          title="Which AI endpoint to use. Local (LM Studio) stays on this PC. Cloud sends only the task/source text."
        >
          <span>Provider</span>
          <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.local ? ' (local)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label
          className="settings-field"
          title="Model id from GET /v1/models. Pick a cheaper or faster model without typing the id."
        >
          <span>Model</span>
          <AiModelSelect
            value={model}
            models={listed.models}
            loading={listed.loading}
            emptyHint="Refresh models in Settings → AI"
            onChange={(next) => {
              setModel(next)
              const p = providers.find((x) => x.id === providerId)
              if (!p || !next) return
              void call(
                api.ai.upsertProvider({
                  id: p.id,
                  name: p.name,
                  type: p.type,
                  baseUrl: p.baseUrl,
                  model: next,
                  local: p.local,
                  timeoutSec: p.timeoutSec
                })
              )
                .then(async () => {
                  const nextSettings = await call(api.settings.get())
                  useAppStore.setState({ settings: nextSettings })
                })
                .catch(() => {})
            }}
          />
        </label>
        <label
          className="settings-field"
          title="Language for the generated script. Auto lets the model choose from PowerShell, Python, cmd, or bash."
        >
          <span>Language</span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'auto' | ScriptLanguage)}
          >
            <option value="auto">Auto</option>
            <option value="powershell">PowerShell</option>
            <option value="python">Python</option>
            <option value="cmd">cmd</option>
            <option value="bash">bash</option>
          </select>
        </label>
        <label
          className="settings-field"
          title="Folder: script gets --root. Selection: selected paths go in a temp --input-list. AI is not told your paths."
        >
          <span>Target</span>
          <select value={target} onChange={(e) => setTarget(e.target.value as 'folder' | 'selection')}>
            <option value="folder">Current folder</option>
            <option value="selection">Selected items</option>
          </select>
        </label>
        <label
          className="settings-toggle"
          title="When the target is the current folder, the script should walk subfolders (--recursive)."
        >
          <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} />
          <span>Recursive</span>
        </label>
        <label
          className="settings-field script-meta-wide"
          title="What the script should do. Do not paste paths or file contents — those are never sent and should not be in the prompt."
        >
          <span>Task</span>
          <textarea
            rows={3}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe what the script should do. Do not paste file paths."
          />
        </label>
        {source ? (
          <label
            className="settings-field script-meta-wide"
            title="Tell AI how to change the current source (Modify button). Only this text plus the source is sent."
          >
            <span>Modify instruction</span>
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Change only this…"
            />
          </label>
        ) : null}
        <label className="settings-field" title="Library and context-menu name after you Save.">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="settings-field" title="Optional note stored with the script. Used when searching the library.">
          <span>Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>
      {error && <div className="script-banner script-banner-warn">{error}</div>}
      <DestructiveBanner source={source} flagged={destructive} />
      <CopyInstall language={language === 'auto' ? 'powershell' : language} deps={dependencies} />
      <SourceEditor
        language={language === 'auto' ? 'powershell' : language}
        value={source}
        onChange={setSource}
      />
    </ScriptModal>
  )
}
