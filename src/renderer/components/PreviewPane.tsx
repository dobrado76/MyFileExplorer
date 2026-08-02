import { Fragment, useEffect, useMemo, useState, type JSX } from 'react'
import type { PreviewModel, PreviewField } from '@shared/schemas/preview'
import { useAppStore } from '../store/appStore'
import { api } from '../lib/ipc'
import { formatBytes } from '../lib/format'
import { basename } from '../lib/paths'
import {
  CopyIcon,
  FileIcon,
  FolderIcon,
  AudioFileIcon,
  VideoFileIcon,
  PdfFileIcon,
  SpinnerIcon
} from '../lib/icons'
import {
  AudioPreview,
  HtmlDocumentPreview,
  MarkdownPreview,
  PdfPreview,
  SpreadsheetPreview,
  VideoPreview
} from './preview/RichPreviews'
import { CodePreview } from './preview/CodePreview'

/* The "file" group is rendered separately as the compact details strip
   pinned to the bottom of the pane. */
const CONTENT_GROUPS: { key: string; label: string }[] = [
  { key: 'generation', label: 'Generation' },
  { key: 'image', label: 'Image' },
  { key: 'other', label: 'Other' }
]

let previewSeq = 0

export function PreviewPane(): JSX.Element {
  const selected = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.selected ?? [])
  const entries = useAppStore((s) => s.listing.entries)
  const notify = useAppStore((s) => s.notify)
  const openPath = useAppStore((s) => s.openPath)

  const [model, setModel] = useState<PreviewModel | null>(null)
  const [loading, setLoading] = useState(false)

  const single = selected.length === 1 ? selected[0]! : null

  useEffect(() => {
    if (!single) {
      setModel(null)
      setLoading(false)
      return
    }
    const seq = ++previewSeq
    setLoading(true)
    void api.preview.get({ path: single }).then((res) => {
      if (seq !== previewSeq) return // superseded — cancel stale preview
      setLoading(false)
      setModel(res.ok ? res.value : null)
    })
  }, [single])

  const multiSummary = useMemo(() => {
    if (selected.length <= 1) return null
    const sel = new Set(selected.map((p) => p.toLowerCase()))
    let total = 0
    let dirs = 0
    for (const e of entries) {
      if (sel.has(e.path.toLowerCase())) {
        total += e.size
        if (e.kind === 'dir') dirs++
      }
    }
    return { count: selected.length, dirs, total }
  }, [selected, entries])

  if (multiSummary) {
    return (
      <div className="preview">
        <div className="preview-header">
          <div className="preview-title">{multiSummary.count} items selected</div>
          <div className="preview-sub">
            {multiSummary.dirs > 0
              ? `${multiSummary.dirs} folder${multiSummary.dirs > 1 ? 's' : ''} · `
              : ''}
            {formatBytes(multiSummary.total)} (files only)
          </div>
        </div>
      </div>
    )
  }

  if (!single) {
    return (
      <div className="preview">
        <div className="preview-empty">Select a file to preview</div>
      </div>
    )
  }

  if (loading && !model) {
    return (
      <div className="preview">
        <div className="preview-empty">
          <SpinnerIcon size={20} className="spin" />
        </div>
      </div>
    )
  }

  if (!model) {
    return (
      <div className="preview">
        <div className="preview-empty">No preview available</div>
      </div>
    )
  }

  const copyValue = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    notify('Copied')
  }

  const fileFields = model.fields.filter((f) => (f.group ?? 'other') === 'file')

  return (
    <div className="preview">
      <div className="preview-header">
        <div className="preview-title">{basename(model.path)}</div>
        <div className="preview-sub">{kindLabel(model.kind)}</div>
      </div>

      <div className="preview-content">
        {model.kind === 'image' && model.mediaUrl && (
          <div className="preview-media">
            <img src={model.mediaUrl} alt={basename(model.path)} draggable={false} />
          </div>
        )}
        {model.kind === 'text' && model.textSample !== undefined && (
          <CodePreview source={model.textSample} path={model.path} />
        )}
        {model.kind === 'markdown' && model.textSample !== undefined && (
          <MarkdownPreview source={model.textSample} />
        )}
        {(model.kind === 'document' || model.kind === 'rtf') && model.htmlBody !== undefined && (
          <HtmlDocumentPreview html={model.htmlBody} />
        )}
        {model.kind === 'spreadsheet' && model.sheets && <SpreadsheetPreview sheets={model.sheets} />}
        {model.kind === 'pdf' && model.mediaUrl && <PdfPreview url={model.mediaUrl} />}
        {model.kind === 'video' && model.mediaUrl && (
          <VideoPreview
            url={model.mediaUrl}
            onOpenExternal={() => void openPath(model.path)}
          />
        )}
        {model.kind === 'audio' && model.mediaUrl && (
          <AudioPreview
            url={model.mediaUrl}
            onOpenExternal={() => void openPath(model.path)}
          />
        )}
        {model.kind === 'binary' && (
          <div className="preview-icon">
            <FileIcon size={56} />
          </div>
        )}
        {(model.kind === 'video' || model.kind === 'audio') && !model.mediaUrl && (
          <>
            <div className="preview-icon">
              {model.kind === 'audio' ? <AudioFileIcon size={56} /> : <VideoFileIcon size={56} />}
            </div>
            <div style={{ textAlign: 'center', paddingBottom: 8 }}>
              <button className="btn" onClick={() => void openPath(model.path)}>
                Open with default app
              </button>
            </div>
          </>
        )}
        {model.kind === 'directory' && (
          <div className="preview-icon">
            <FolderIcon size={56} />
          </div>
        )}
        {model.kind === 'pdf' && !model.mediaUrl && (
          <>
            <div className="preview-icon">
              <PdfFileIcon size={56} />
            </div>
            <div style={{ textAlign: 'center', paddingBottom: 8 }}>
              <button className="btn" onClick={() => void openPath(model.path)}>
                Open with default app
              </button>
            </div>
          </>
        )}
        {model.kind === 'missing' && <div className="preview-empty">File no longer exists</div>}

        {model.warnings && model.warnings.length > 0 && (
          <div className="preview-warnings">{model.warnings.join(' · ')}</div>
        )}

        {model.fields.some((f) => (f.group ?? 'other') !== 'file') && (
          <div className="preview-fields">
            {CONTENT_GROUPS.map(({ key, label }) => {
              const fields = model.fields.filter((f) => (f.group ?? 'other') === key)
              if (fields.length === 0) return null
              return (
                <div key={key}>
                  <div className="preview-group-title">{label}</div>
                  {fields.map((f) => (
                    <Field key={f.id} field={f} onCopy={copyValue} />
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {fileFields.length > 0 && (
        <div className="preview-details">
          {fileFields.map((f) => (
            <Fragment key={f.id}>
              <div className="d-label">
                {f.label}
                {f.copyable && (
                  <button
                    className="field-copy"
                    aria-label={`Copy ${f.label}`}
                    onClick={() => void copyValue(f.value)}
                  >
                    <CopyIcon size={12} />
                  </button>
                )}
              </div>
              <div className={`d-value${f.mono ? ' mono' : ''}`}>{f.value}</div>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({
  field,
  onCopy
}: {
  field: PreviewField
  onCopy(v: string): Promise<void>
}): JSX.Element {
  return (
    <div className="preview-field">
      <div className="field-label">
        {field.label}
        {field.copyable && (
          <button
            className="field-copy"
            aria-label={`Copy ${field.label}`}
            onClick={() => void onCopy(field.value)}
          >
            <CopyIcon size={12} />
          </button>
        )}
      </div>
      <div className={`field-value${field.mono ? ' mono' : ''}`}>{field.value}</div>
    </div>
  )
}

function kindLabel(kind: PreviewModel['kind']): string {
  switch (kind) {
    case 'image':
      return 'Image'
    case 'text':
      return 'Text'
    case 'markdown':
      return 'Markdown'
    case 'spreadsheet':
      return 'Spreadsheet'
    case 'document':
      return 'Word document'
    case 'rtf':
      return 'Rich text'
    case 'audio':
      return 'Audio'
    case 'video':
      return 'Video'
    case 'pdf':
      return 'PDF'
    case 'directory':
      return 'Folder'
    case 'missing':
      return 'Missing'
    default:
      return 'File'
  }
}
