import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { PreviewModel, PreviewField } from '@shared/schemas/preview'
import { useAppStore } from '../store/appStore'
import { api } from '../lib/ipc'
import { basename, samePath } from '../lib/paths'
import { searchResultsToEntries } from '../lib/searchEntries'
import { recycleBinItemsToEntries } from '../lib/recycleBinEntries'
import { highlightLanguage } from '../lib/highlight'
import {
  CopyIcon,
  FileIcon,
  FolderIcon,
  AudioFileIcon,
  VideoFileIcon,
  PdfFileIcon,
  SpinnerIcon,
  EditImageIcon
} from '../lib/icons'
import { isEditableImagePath } from '@shared/imageEdit'
import {
  AudioPreview,
  HtmlDocumentPreview,
  HtmlSourcePreview,
  MarkdownPreview,
  PdfPreview,
  SpreadsheetPreview,
  VideoPreview,
  VideoStripPreview
} from './preview/RichPreviews'
import { CodePreview } from './preview/CodePreview'
import { ZipArchivePreview } from './preview/ZipArchivePreview'

/* The "file" group is rendered separately as the compact details strip
   pinned to the bottom of the pane. Weights/summary ("other") before training. */
const CONTENT_GROUPS: { key: string; label: string }[] = [
  { key: 'executable', label: 'Details' },
  { key: 'shortcut', label: 'Shortcut' },
  { key: 'other', label: 'Other' },
  { key: 'generation', label: 'Generation' },
  { key: 'image', label: 'Image' }
]

let previewSeq = 0

export function PreviewPane(): JSX.Element {
  const selected = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.selected ?? [])
  const focusedPath = useAppStore((s) => s.focusedPath)
  const listingEntries = useAppStore((s) => s.listing.entries)
  const search = useAppStore((s) => s.search)
  const recycleBin = useAppStore((s) => s.recycleBin)
  const notify = useAppStore((s) => s.notify)
  const openPath = useAppStore((s) => s.openPath)
  const openImageEditor = useAppStore((s) => s.openImageEditor)
  const extractZip = useAppStore((s) => s.extractZip)
  const mediaHold = useAppStore((s) => s.mediaHold)
  const previewVideoAutoplay = useAppStore((s) => s.settings.previewVideoAutoplay)

  const entries = useMemo(
    () =>
      recycleBin.active
        ? recycleBinItemsToEntries(recycleBin.items)
        : search.active
          ? searchResultsToEntries(search.results)
          : listingEntries,
    [recycleBin.active, recycleBin.items, search.active, search.results, listingEntries]
  )

  const [model, setModel] = useState<PreviewModel | null>(null)
  const [loading, setLoading] = useState(false)
  /** One force-transcode attempt per path (avoid audio-only retry loops). */
  const forcePlayableTried = useRef<string | null>(null)

  /** Most recently interacted selected path (not “last in range order”). */
  const previewPath = useMemo(() => {
    if (selected.length === 0) return null
    if (focusedPath && selected.some((p) => samePath(p, focusedPath))) return focusedPath
    return selected[selected.length - 1]!
  }, [selected, focusedPath])

  // After in-place edits, path is unchanged but mtime/size update via refresh().
  const selectedStamp = useMemo(() => {
    if (!previewPath) return null
    const e = entries.find((en) => samePath(en.path, previewPath))
    return e ? `${e.mtimeMs}:${e.size}` : null
  }, [previewPath, entries])

  useEffect(() => {
    if (!previewPath) {
      setModel(null)
      setLoading(false)
      forcePlayableTried.current = null
      return
    }
    forcePlayableTried.current = null
    const seq = ++previewSeq
    setLoading(true)
    // Same path after an in-place edit: drop the old model so we don't keep
    // painting stale pixels while the new preview (cache-busted URL) loads.
    // Different path: keep prior model painted until the next preview arrives
    // (avoids black flash on delete / arrow navigation).
    setModel((prev) => (prev && samePath(prev.path, previewPath) ? null : prev))
    void api.preview.get({ path: previewPath }).then((res) => {
      if (seq !== previewSeq) return // superseded — cancel stale preview
      setLoading(false)
      const next = res.ok ? res.value : null
      setModel(next)
      // MKV/AVI/etc.: remux/transcode to MP4 in main so Chromium can play inline.
      if (next?.kind === 'video' && next.needsPlayable && !next.mediaUrl) {
        void api.preview.ensurePlayable({ path: previewPath }).then((play) => {
          if (seq !== previewSeq) return
          const mediaUrl = play.ok ? play.value.mediaUrl : null
          setModel((prev) =>
            prev && samePath(prev.path, previewPath)
              ? {
                  ...prev,
                  mediaUrl: mediaUrl ?? undefined,
                  needsPlayable: false,
                  warnings:
                    mediaUrl || !prev.posterUrl
                      ? prev.warnings
                      : [
                          ...(prev.warnings ?? []),
                          'In-app convert timed out or failed — open with the default app to watch'
                        ]
                }
              : prev
          )
        })
      }
    })
  }, [previewPath, selectedStamp])

  const retryPlayableForce = (): void => {
    if (!previewPath) return
    const path = previewPath
    if (forcePlayableTried.current && samePath(forcePlayableTried.current, path)) return
    forcePlayableTried.current = path
    setModel((prev) =>
      prev && samePath(prev.path, path)
        ? { ...prev, mediaUrl: undefined, needsPlayable: true }
        : prev
    )
    void api.preview.ensurePlayable({ path, force: true }).then((play) => {
      const mediaUrl = play.ok ? play.value.mediaUrl : null
      setModel((prev) => {
        if (!prev || !samePath(prev.path, path)) return prev
        return {
          ...prev,
          mediaUrl: mediaUrl ?? undefined,
          needsPlayable: false,
          warnings:
            mediaUrl || !prev.posterUrl
              ? prev.warnings
              : [
                  ...(prev.warnings ?? []),
                  'In-app convert timed out or failed — open with the default app to watch'
                ]
        }
      })
    })
  }

  const multiCount = selected.length > 1 ? selected.length : 0

  if (!previewPath) {
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
  const contentFields = model.fields.filter((f) => (f.group ?? 'other') !== 'file')
  const hasRichFields = contentFields.length > 0

  const headerSub = model.subtitle ?? kindLabel(model.kind)
  const multiHint = multiCount > 0 ? `${multiCount} selected` : null

  return (
    <div
      className={`preview${
        model.kind === 'image'
          ? ' preview-kind-image'
          : model.kind === 'archive'
            ? ' preview-kind-archive'
            : ''
      }`}
    >
      {headerSub || multiHint || (model.kind === 'image' && model.mediaUrl) ? (
        <div className="preview-header preview-header-compact">
          <div className="preview-sub">
            {multiHint ? (
              <>
                <span className="preview-multi-badge">{multiHint}</span>
                {headerSub ? <span className="preview-multi-sep">·</span> : null}
              </>
            ) : null}
            {headerSub}
          </div>
          {model.kind === 'image' &&
            model.mediaUrl &&
            isEditableImagePath(model.path) && (
              <button
                type="button"
                className="icon-btn preview-edit-btn"
                aria-label="Edit image"
                title="Edit image"
                onClick={() => openImageEditor(model.path, model.mediaUrl!)}
              >
                <EditImageIcon size={16} />
              </button>
            )}
        </div>
      ) : null}

      <div className="preview-content">
        {/* Images stay mounted during mediaHold — mfe-media does not lock the source (D7). */}
        {model.kind === 'image' && model.mediaUrl && (
          <div className="preview-media preview-media-fill">
            <img src={model.mediaUrl} alt={basename(model.path)} draggable={false} />
          </div>
        )}
        {model.kind === 'text' && model.textSample !== undefined && (
          <CodePreview source={model.textSample} path={model.path} />
        )}
        {model.kind === 'markdown' && model.textSample !== undefined && (
          <MarkdownPreview source={model.textSample} path={model.path} />
        )}
        {model.kind === 'html' && model.textSample !== undefined && (
          <HtmlSourcePreview source={model.textSample} path={model.path} />
        )}
        {(model.kind === 'document' || model.kind === 'rtf') && model.htmlBody !== undefined && (
          <HtmlDocumentPreview html={model.htmlBody} />
        )}
        {model.kind === 'spreadsheet' && model.sheets && <SpreadsheetPreview sheets={model.sheets} />}
        {model.kind === 'pdf' && model.mediaUrl && !mediaHold && (
          <PdfPreview url={model.mediaUrl} />
        )}
        {model.kind === 'video' &&
          model.stripFrames &&
          model.stripFrames.length > 0 &&
          !mediaHold && (
            <VideoStripPreview
              frames={model.stripFrames}
              onOpenExternal={() => void openPath(model.path)}
            />
          )}
        {model.kind === 'video' &&
          !model.stripFrames?.length &&
          (model.mediaUrl || model.posterUrl || model.needsPlayable) &&
          !mediaHold && (
          <VideoPreview
            url={model.mediaUrl}
            posterUrl={model.posterUrl}
            preparing={Boolean(model.needsPlayable && !model.mediaUrl)}
            autoplay={previewVideoAutoplay}
            onOpenExternal={() => void openPath(model.path)}
            onAudioOnly={retryPlayableForce}
          />
        )}
        {model.kind === 'audio' && model.mediaUrl && !mediaHold && (
          <AudioPreview
            url={model.mediaUrl}
            autoplay={previewVideoAutoplay}
            onOpenExternal={() => void openPath(model.path)}
          />
        )}
        {model.kind === 'binary' && !hasRichFields && (
          <div className="preview-icon">
            <FileIcon size={56} />
          </div>
        )}
        {model.kind === 'executable' && (
          <div className="preview-exe">
            <div className="preview-icon preview-exe-icon">
              {model.mediaUrl ? (
                <img src={model.mediaUrl} alt="" width={64} height={64} draggable={false} />
              ) : (
                <FileIcon size={56} />
              )}
            </div>
          </div>
        )}
        {((model.kind === 'video' &&
          !model.mediaUrl &&
          !model.posterUrl &&
          !model.needsPlayable &&
          !model.stripFrames?.length) ||
          (model.kind === 'audio' && !model.mediaUrl)) && (
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
        {model.kind === 'archive' && (
          <ZipArchivePreview
            tree={model.archiveTree ?? []}
            treeLabel={
              model.archiveFormat === 'unitypackage' ? 'Unity package contents' : 'ZIP contents'
            }
            onExtract={
              model.archiveFormat === 'unitypackage'
                ? undefined
                : () => void extractZip([model.path])
            }
          />
        )}
        {model.kind === 'shortcut' && (
          <div className="preview-shortcut">
            <div className="preview-icon">
              <FileIcon size={56} />
            </div>
            <div className="preview-shortcut-caption">Windows shortcut</div>
            {(() => {
              const target = model.fields.find((f) => f.id === 'lnk.target')?.value
              if (!target) return null
              return <div className="preview-shortcut-target mono">{target}</div>
            })()}
            <div className="preview-shortcut-actions">
              <button className="btn" onClick={() => void openPath(model.path)}>
                Open shortcut
              </button>
              {(() => {
                const target = model.fields.find((f) => f.id === 'lnk.target')?.value
                const kind = model.fields.find((f) => f.id === 'lnk.targetKind')?.value ?? ''
                if (!target || kind.includes('URL') || kind.includes('Missing')) return null
                return (
                  <button className="btn" onClick={() => void openPath(target)}>
                    Open target
                  </button>
                )
              })()}
            </div>
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

        {hasRichFields && (
          <div className={`preview-fields${model.kind === 'binary' ? ' preview-fields-flush' : ''}`}>
            {CONTENT_GROUPS.map(({ key, label }) => {
              const fields = contentFields.filter((f) => (f.group ?? 'other') === key)
              if (fields.length === 0) return null
              const groupLabel =
                key === 'generation' && model.subtitle?.startsWith('SafeTensors')
                  ? 'Training'
                  : key === 'other' && model.subtitle?.startsWith('SafeTensors')
                    ? 'Weights'
                    : label
              return (
                <div key={key}>
                  <div className="preview-group-title">{groupLabel}</div>
                  {key === 'generation' ? (
                    <GenerationFields fields={fields} onCopy={copyValue} />
                  ) : (
                    fields.map((f) => <Field key={f.id} field={f} onCopy={copyValue} />)
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {fileFields.length > 0 && <DetailsStrip fields={fileFields} onCopy={copyValue} />}
    </div>
  )
}

const DETAILS_LEAD = ['file.name', 'image.dimensions'] as const

function DetailsStrip({
  fields,
  onCopy
}: {
  fields: PreviewField[]
  onCopy(v: string): Promise<void>
}): JSX.Element {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const used = new Set<string>()

  const take = (id: string): PreviewField | undefined => {
    const f = byId.get(id)
    if (f) used.add(id)
    return f
  }

  const lead = DETAILS_LEAD.map((id) => take(id)).filter(Boolean) as PreviewField[]
  const left = (['file.type', 'file.size'] as const).map((id) => take(id)).filter(Boolean) as PreviewField[]
  const right = (['file.modified', 'file.created'] as const)
    .map((id) => take(id))
    .filter(Boolean) as PreviewField[]
  const rest = fields.filter((f) => !used.has(f.id) && f.id !== 'file.path')

  const hasPair = left.length > 0 || right.length > 0

  return (
    <div className="preview-details">
      {lead.map((f) => (
        <DetailRow key={f.id} field={f} onCopy={onCopy} />
      ))}
      {hasPair && (
        <div className="preview-details-pair">
          <div className="preview-details-col">
            {left.map((f) => (
              <DetailRow key={f.id} field={f} onCopy={onCopy} />
            ))}
          </div>
          <div className="preview-details-col">
            {right.map((f) => (
              <DetailRow key={f.id} field={f} onCopy={onCopy} />
            ))}
          </div>
        </div>
      )}
      {rest.map((f) => (
        <DetailRow key={f.id} field={f} onCopy={onCopy} />
      ))}
    </div>
  )
}

function DetailRow({
  field,
  onCopy
}: {
  field: PreviewField
  onCopy(v: string): Promise<void>
}): JSX.Element {
  return (
    <div className="d-row">
      <div className="d-label">
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
      <div className={`d-value${field.mono ? ' mono' : ''}`}>{field.value}</div>
    </div>
  )
}

function isCompactGenField(f: PreviewField): boolean {
  if (
    f.id === 'gen.prompt' ||
    f.id === 'gen.negative' ||
    f.id.startsWith('gen.raw') ||
    f.id.toLowerCase().includes('json')
  ) {
    return false
  }
  if (f.value.includes('\n')) return false
  // Long model names / hashes still chip-wrap; very long blobs stay block.
  if (f.value.length > 120) return false
  return true
}

function GenerationFields({
  fields,
  onCopy
}: {
  fields: PreviewField[]
  onCopy(v: string): Promise<void>
}): JSX.Element {
  const compact: PreviewField[] = []
  const blocks: PreviewField[] = []
  for (const f of fields) {
    if (isCompactGenField(f)) compact.push(f)
    else blocks.push(f)
  }
  return (
    <>
      {compact.length > 0 ? (
        <div className="preview-gen-flow">
          {compact.map((f) => (
            <Field key={f.id} field={f} onCopy={onCopy} compact />
          ))}
        </div>
      ) : null}
      {blocks.map((f) => (
        <Field key={f.id} field={f} onCopy={onCopy} />
      ))}
    </>
  )
}

function Field({
  field,
  onCopy,
  compact = false
}: {
  field: PreviewField
  onCopy(v: string): Promise<void>
  compact?: boolean
}): JSX.Element {
  const highlighted = useMemo(() => {
    if (field.syntax !== 'json') return null
    return highlightLanguage(field.value, 'json').html
  }, [field.syntax, field.value])
  const multiline =
    !compact && (highlighted !== null || !!field.mono || field.value.includes('\n'))

  return (
    <div
      className={`preview-field${multiline ? ' is-multiline' : ''}${compact ? ' is-compact' : ''}`}
    >
      <div className="field-label">
        <span className="field-label-text">{field.label}</span>
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
      {highlighted !== null ? (
        <pre className="field-value mono preview-code field-code">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      ) : (
        <div className={`field-value${field.mono || multiline ? ' mono' : ''}`}>{field.value}</div>
      )}
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
    case 'html':
      return 'HTML'
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
    case 'shortcut':
      return 'Shortcut'
    case 'archive':
      return 'Archive'
    case 'executable':
      return 'Application'
    case 'missing':
      return 'Missing'
    default:
      return 'File'
  }
}
