import { useEffect, useState, type JSX } from 'react'
import {
  extractGitCloneUrl,
  folderNameFromGitUrl,
  isValidCloneFolderName,
  looksLikeGitCloneUrl
} from '@shared/gitCloneUrl'
import { useAppStore } from '../../store/appStore'
import { api, call, IpcError } from '../../lib/ipc'
import { joinPath } from '../../lib/paths'
import { ModalShell, gitCmdOk } from './GitDialogs'

export function CloneGitRepoDialog({ parent }: { parent: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const notify = useAppStore((s) => s.notify)
  const navigate = useAppStore((s) => s.navigate)
  const refresh = useAppStore((s) => s.refresh)
  const setSelection = useAppStore((s) => s.setSelection)
  const gitEnabled = useAppStore((s) => s.settings.git?.enabled === true)
  const openDialog = useAppStore((s) => s.openDialog)

  const [folderName, setFolderName] = useState('')
  const [url, setUrl] = useState('')
  const [clash, setClash] = useState(false)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const text = await navigator.clipboard.readText()
        if (cancelled) return
        const found = extractGitCloneUrl(text)
        if (!found) return
        setUrl(found)
        const suggested = folderNameFromGitUrl(found)
        if (suggested) setFolderName(suggested)
      } catch {
        /* clipboard permission / empty */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const name = folderName.trim()
    if (!name || !isValidCloneFolderName(name)) {
      setClash(false)
      setChecking(false)
      return
    }
    let cancelled = false
    setChecking(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await call(api.fs.exists({ path: joinPath(parent, name) }))
          if (!cancelled) setClash(res.exists)
        } catch {
          if (!cancelled) setClash(false)
        } finally {
          if (!cancelled) setChecking(false)
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [folderName, parent])

  const onUrlChange = (next: string): void => {
    setUrl(next)
    setError(null)
    if (!nameTouched) {
      const found = extractGitCloneUrl(next) ?? (looksLikeGitCloneUrl(next.trim()) ? next.trim() : null)
      if (found) {
        const suggested = folderNameFromGitUrl(found)
        if (suggested) setFolderName(suggested)
      }
    }
  }

  const trimmedName = folderName.trim()
  const trimmedUrl = url.trim()
  const nameOk = isValidCloneFolderName(trimmedName)
  const urlOk = looksLikeGitCloneUrl(trimmedUrl)
  const canClone = gitEnabled && nameOk && urlOk && !clash && !checking && !busy

  const submit = async (): Promise<void> => {
    if (!gitEnabled) {
      setError('Enable Git integration in Settings → Git first.')
      return
    }
    if (!canClone) return
    setBusy(true)
    setError(null)
    try {
      const res = await call(
        api.git.clone({
          parentDir: parent,
          folderName: trimmedName,
          url: trimmedUrl
        })
      )
      if (!res.success) {
        setError(gitCmdOk(res) || 'Clone failed')
        setBusy(false)
        return
      }
      closeDialog()
      notify(`Cloned ${trimmedName}`)
      await navigate(parent)
      await refresh()
      setSelection([res.path], res.path, res.path)
    } catch (e) {
      setError(e instanceof IpcError ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <ModalShell
      title="Clone GitHub repository"
      onClose={() => {
        if (!busy) closeDialog()
      }}
      modalClassName="git-clone-modal"
      actions={
        <>
          {!gitEnabled ? (
            <button
              type="button"
              className="btn"
              onClick={() => openDialog({ kind: 'settings', section: 'git' })}
            >
              Open Git settings
            </button>
          ) : null}
          <button type="button" className="btn" disabled={busy} onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!canClone}
            onClick={() => void submit()}
          >
            {busy ? 'Cloning…' : 'Clone'}
          </button>
        </>
      }
    >
      <p className="dim git-clone-help">
        Creates a new folder in the current directory and runs <code>git clone</code>. Private
        remotes use Git Credential Manager / SSH.
      </p>
      {!gitEnabled ? (
        <p className="git-clone-warn">Git integration is off. Enable it in Settings → Git to clone.</p>
      ) : null}
      <div className="form-row">
        <label htmlFor="git-clone-url">Repository URL</label>
        <input
          id="git-clone-url"
          type="text"
          autoFocus
          placeholder="https://github.com/org/repo.git"
          value={url}
          disabled={busy}
          onChange={(e) => onUrlChange(e.target.value)}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text')
            const found = extractGitCloneUrl(text)
            if (found) {
              e.preventDefault()
              onUrlChange(found)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canClone) void submit()
          }}
        />
      </div>
      <div className="form-row">
        <label htmlFor="git-clone-name">Folder name</label>
        <input
          id="git-clone-name"
          type="text"
          value={folderName}
          disabled={busy}
          onChange={(e) => {
            setNameTouched(true)
            setFolderName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canClone) void submit()
          }}
        />
      </div>
      {trimmedName && !nameOk ? (
        <p className="git-clone-warn">Folder name is invalid (illegal characters or empty).</p>
      ) : null}
      {trimmedName && nameOk && clash ? (
        <p className="git-clone-warn">A folder or file named “{trimmedName}” already exists here.</p>
      ) : null}
      {trimmedUrl && !urlOk ? (
        <p className="git-clone-warn">Enter a Git URL (for example ending in .git).</p>
      ) : null}
      {error ? <p className="git-clone-error">{error}</p> : null}
    </ModalShell>
  )
}
