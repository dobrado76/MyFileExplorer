import { useEffect, useState, type JSX } from 'react'
import { useAppStore } from '../store/appStore'
import { api, call } from '../lib/ipc'
import { basename } from '../lib/paths'
import type { CreateLinkType } from '@shared/schemas/createLink'

export function CreateLinkDialog({ source }: { source: string }): JSX.Element {
  const closeDialog = useAppStore((s) => s.closeDialog)
  const createLink = useAppStore((s) => s.createLink)
  const currentFolder = useAppStore((s) => s.activeTab().path)
  const [destDir, setDestDir] = useState(currentFolder)
  const [name, setName] = useState(basename(source))
  const [type, setType] = useState<CreateLinkType>('symlink')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeDialog()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closeDialog])

  const submit = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await createLink(source, destDir, type, name.trim())
      closeDialog()
    } finally {
      setBusy(false)
    }
  }

  const browse = async (): Promise<void> => {
    const res = await call(api.app.pickFolder())
    if (res.path) setDestDir(res.path)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div className="modal" role="dialog" aria-label="Create link">
        <div className="modal-title">Create link</div>
        <div className="modal-body">
          <p className="dim">Source: {source}</p>
          <div className="form-row">
            <label htmlFor="cl-type">Type</label>
            <select
              id="cl-type"
              value={type}
              onChange={(e) => setType(e.target.value as CreateLinkType)}
            >
              <option value="symlink">Symbolic link</option>
              <option value="hard">Hard link (file, same volume)</option>
              <option value="junction">Junction (folder)</option>
            </select>
          </div>
          <div className="form-row">
            <label htmlFor="cl-dest">Destination folder</label>
            <div className="settings-inline">
              <input id="cl-dest" type="text" value={destDir} onChange={(e) => setDestDir(e.target.value)} />
              <button type="button" className="btn" onClick={() => void browse()}>
                Browse…
              </button>
            </div>
          </div>
          <div className="form-row">
            <label htmlFor="cl-name">Name</label>
            <input
              id="cl-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </div>
          <p className="dim">
            Hard link = file on the same volume. Junction = folder. A directory symbolic link may
            need Developer Mode or administrator.
          </p>
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={closeDialog} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy || !name.trim()}>
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
