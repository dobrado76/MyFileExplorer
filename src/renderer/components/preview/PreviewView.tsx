import { useMemo, useState, type JSX, type ReactNode } from 'react'
import type { PreviewModel, PreviewField } from '@shared/schemas/preview'
import { highlightLanguage } from '../../lib/highlight'
import { basename } from '../../lib/paths'
import {
  CopyIcon,
  FileIcon,
  FolderIcon,
  AudioFileIcon,
  VideoFileIcon,
  PdfFileIcon,
  SpinnerIcon,
  WrapTextIcon
} from '../../lib/icons'
import {
  AudioPreview,
  HtmlDocumentPreview,
  HtmlSourcePreview,
  EmlPreview,
  IcsPreview,
  MarkdownPreview,
  PdfPreview,
  PowerPointPreview,
  SpreadsheetPreview,
  VideoPreview,
  VideoStripPreview
} from './RichPreviews'
import { allowDockedAvPlayer } from '@shared/previewAv'
import { CodePreview } from './CodePreview'
import { ZipArchivePreview } from './ZipArchivePreview'
import { ChmPreview } from './ChmPreview'
import { FontPreview } from './FontPreview'
import { Model3dPreview } from './Model3dPreview'
import { DriveSpacePreview } from './DriveSpacePreview'
import {
  MediaMetadataDetails,
  MediaMetadataHero,
  MediaMetadataPreview,
  MediaMetadataProvider,
  mediaMetadataHasDetails,
  useMediaMetadata
} from '../MediaMetadataPreview'
import type { DriveInfo } from '@shared/schemas/fs'

function archiveContentsLabel(format: PreviewModel['archiveFormat']): string {
  switch (format) {
    case 'unitypackage':
      return 'Unity package contents'
    case '7z':
      return '7z contents'
    case 'rar':
      return 'RAR contents'
    case 'tar':
      return 'TAR contents'
    case 'targz':
      return 'TAR.GZ contents'
    case 'apk':
      return 'APK contents'
    case 'msi':
      return 'MSI contents'
    case 'iso':
      return 'ISO contents'
    case 'img':
      return 'IMG contents'
    case 'zip':
    default:
      return 'ZIP contents'
  }
}

/* The "file" group is rendered separately as the compact details strip
   pinned to the bottom of the pane. Weights/summary ("other") before training. */
const CONTENT_GROUPS: { key: string; label: string }[] = [
  { key: 'audio', label: 'Audio' },
  { key: 'video', label: 'Video' },
  { key: 'executable', label: 'Details' },
  { key: 'shortcut', label: 'Shortcut' },
  { key: 'other', label: 'Other' },
  { key: 'generation', label: 'Generation' },
  { key: 'image', label: 'Image' }
]

export function kindLabel(kind: PreviewModel['kind']): string {
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
    case 'chm':
      return 'HTML Help'
    case 'executable':
      return 'Application'
    case 'model3d':
      return '3D model'
    case 'missing':
      return 'Missing'
    default:
      return 'File'
  }
}

export type PreviewViewProps = {
  model: PreviewModel | null
  loading: boolean
  previewPath: string | null
  multiCount?: number
  mediaHold?: boolean
  /** When the pop-out is open, the docked pane must not mount `<video>`/`<audio>`. */
  previewWindowOpen?: boolean
  previewVideoAutoplay?: boolean
  captionPosterUrl?: string | null
  /** Pop-out only: hide metadata / details and fill with the visualization. */
  zen?: boolean
  /** Wrap long lines in text / code previews. */
  textWordWrap?: boolean
  onToggleTextWordWrap?: () => void
  headerActions?: ReactNode
  banner?: ReactNode
  onOpenPath: (path: string) => void
  onExtractZip?: (paths: string[]) => void
  onNotify?: (text: string) => void
  onRetryPlayableForce: () => void
  /** Volume pies — all drives, or one drive when `focusPath` is set. */
  driveSpace?: { drives: DriveInfo[]; focusPath?: string | null } | null
}

export function PreviewView({
  model,
  loading,
  previewPath,
  multiCount = 0,
  mediaHold = false,
  previewWindowOpen = false,
  previewVideoAutoplay = false,
  captionPosterUrl = null,
  zen = false,
  textWordWrap = false,
  onToggleTextWordWrap,
  headerActions,
  banner,
  onOpenPath,
  onExtractZip,
  onNotify,
  onRetryPlayableForce,
  driveSpace = null
}: PreviewViewProps): JSX.Element {
  const headerSub = driveSpace
    ? driveSpace.focusPath
      ? 'Local disk'
      : 'Drives'
    : model
      ? (model.subtitle ?? kindLabel(model.kind))
      : null
  const multiHint = multiCount > 1 ? `${multiCount} selected` : null

  const copyValue = async (value: string): Promise<void> => {
    await navigator.clipboard.writeText(value)
    onNotify?.('Copied')
  }

  const kindClass =
    model?.kind === 'image'
      ? ' preview-kind-image'
      : model?.kind === 'video'
        ? ' preview-kind-video'
        : model?.kind === 'archive'
          ? ' preview-kind-archive'
          : model?.kind === 'chm'
            ? ' preview-kind-chm'
            : model?.kind === 'model3d'
              ? ' preview-kind-model3d'
              : ''

  const showWrapToggle =
    !!onToggleTextWordWrap &&
    (model?.kind === 'text' || model?.kind === 'markdown' || model?.kind === 'html')

  return (
    <div
      className={`preview${kindClass}${zen ? ' preview-zen' : ''}${textWordWrap ? ' preview-text-wrap' : ''}`}
    >
      <div className="preview-header preview-header-compact">
        {!zen ? (
          <div className="preview-sub">
            {multiHint ? (
              <>
                <span className="preview-multi-badge">{multiHint}</span>
                {headerSub ? <span className="preview-multi-sep">·</span> : null}
              </>
            ) : null}
            {headerSub}
          </div>
        ) : null}
        {showWrapToggle || headerActions ? (
          <div className="preview-header-actions">
            {showWrapToggle ? (
              <button
                type="button"
                className={`icon-btn preview-wrap-btn${textWordWrap ? ' active' : ''}`}
                aria-label={textWordWrap ? 'Disable word wrap' : 'Enable word wrap'}
                aria-pressed={textWordWrap}
                title={textWordWrap ? 'Word wrap on' : 'Word wrap off'}
                onClick={onToggleTextWordWrap}
              >
                <WrapTextIcon size={16} />
              </button>
            ) : null}
            {headerActions}
          </div>
        ) : null}
      </div>

      {!zen ? banner : null}

      {driveSpace ? (
        <DriveSpacePreview drives={driveSpace.drives} focusPath={driveSpace.focusPath} />
      ) : !previewPath ? (
        <div className="preview-empty">Select a file to preview</div>
      ) : loading && !model ? (
        <div className="preview-empty">
          <SpinnerIcon size={20} className="spin" />
        </div>
      ) : !model ? (
        <div className="preview-content">
          {previewPath && !zen ? (
            <MediaMetadataProvider path={previewPath}>
              <MediaMetadataPreview />
            </MediaMetadataProvider>
          ) : null}
          <div className="preview-empty">No preview available</div>
        </div>
      ) : (
        <PreviewBody
          model={model}
          previewPath={previewPath}
          mediaHold={mediaHold}
          previewWindowOpen={previewWindowOpen}
          previewVideoAutoplay={previewVideoAutoplay}
          captionPosterUrl={captionPosterUrl}
          zen={zen}
          onOpenPath={onOpenPath}
          onExtractZip={onExtractZip}
          onCopy={copyValue}
          onRetryPlayableForce={onRetryPlayableForce}
        />
      )}
    </div>
  )
}

function PreviewBody({
  model,
  previewPath,
  mediaHold,
  previewWindowOpen,
  previewVideoAutoplay,
  captionPosterUrl,
  zen,
  onOpenPath,
  onExtractZip,
  onCopy,
  onRetryPlayableForce
}: {
  model: PreviewModel
  previewPath: string
  mediaHold: boolean
  previewWindowOpen: boolean
  previewVideoAutoplay: boolean
  captionPosterUrl: string | null
  zen: boolean
  onOpenPath: (path: string) => void
  onExtractZip?: (paths: string[]) => void
  onCopy: (value: string) => Promise<void>
  onRetryPlayableForce: () => void
}): JSX.Element {
  const fileFields = model.fields.filter((f) => (f.group ?? 'other') === 'file')
  const contentFields = model.fields.filter((f) => (f.group ?? 'other') !== 'file')
  const hasRichFields = contentFields.length > 0
  const playAv = allowDockedAvPlayer({ mediaHold, previewWindowOpen })

  return (
    <MediaMetadataProvider path={previewPath}>
      <div className="preview-content">
        <div className="preview-viz">
        {!zen ? <MediaMetadataHero /> : null}
        {/* Images stay mounted during mediaHold — mfe-media does not lock the source (D7). */}
        {model.kind === 'image' && (captionPosterUrl || model.mediaUrl) && (
          <div className="preview-media preview-media-fill">
            <img
              src={captionPosterUrl || model.mediaUrl}
              alt={basename(model.path)}
              draggable={false}
            />
          </div>
        )}
        {model.kind === 'text' && model.textSample !== undefined && (
          /\.(ics|ical)$/i.test(model.path) ? (
            <IcsPreview source={model.textSample} path={model.path} />
          ) : /\.eml$/i.test(model.path) ? (
            <EmlPreview source={model.textSample} path={model.path} />
          ) : (
            <CodePreview source={model.textSample} path={model.path} />
          )
        )}
        {model.kind === 'markdown' && model.textSample !== undefined && (
          <MarkdownPreview source={model.textSample} path={model.path} />
        )}
        {model.kind === 'html' && model.textSample !== undefined && (
          <HtmlSourcePreview source={model.textSample} path={model.path} />
        )}
        {model.pptSlides && model.pptSlides.length > 0 && (
          <PowerPointPreview slides={model.pptSlides} />
        )}
        {(model.kind === 'document' || model.kind === 'rtf') &&
          model.htmlBody !== undefined &&
          !model.pptSlides?.length && <HtmlDocumentPreview html={model.htmlBody} />}
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
              onOpenExternal={() => onOpenPath(model.path)}
              chrome={!zen}
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
              active={playAv}
              onOpenExternal={() => onOpenPath(model.path)}
              onAudioOnly={onRetryPlayableForce}
            />
          )}
        {model.kind === 'audio' && model.mediaUrl && !mediaHold && (
          <AudioPreview
            url={model.mediaUrl}
            coverUrl={model.posterUrl}
            autoplay={previewVideoAutoplay}
            active={playAv}
            onOpenExternal={() => onOpenPath(model.path)}
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
        {model.kind === 'font' && model.mediaUrl && !mediaHold && (
          <FontPreview url={model.mediaUrl} />
        )}
        {model.kind === 'font' && !model.mediaUrl && (
          <div className="preview-font preview-font-error">Font preview unavailable</div>
        )}
        {model.kind === 'model3d' && model.mediaUrl && !mediaHold && (
          <Model3dPreview
            url={model.mediaUrl}
            filePath={model.path}
            ext={(() => {
              const base = model.path.replace(/^.*[/\\]/, '')
              const i = base.lastIndexOf('.')
              return i >= 0 ? base.slice(i + 1) : ''
            })()}
          />
        )}
        {model.kind === 'model3d' && !model.mediaUrl && (
          <div className="preview-model3d-status">3D preview skipped (file too large or unreadable)</div>
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
            {!zen ? (
              <div style={{ textAlign: 'center', paddingBottom: 8 }}>
                <button className="btn" onClick={() => onOpenPath(model.path)}>
                  Open with default app
                </button>
              </div>
            ) : null}
          </>
        )}
        {model.kind === 'directory' && (
          <div className="preview-icon">
            <FolderIcon size={56} />
          </div>
        )}
        {model.kind === 'archive' && (
          <>
            {!zen && model.mediaUrl && (
              <div className="preview-exe">
                <div className="preview-icon preview-exe-icon">
                  <img src={model.mediaUrl} alt="" width={64} height={64} draggable={false} />
                </div>
              </div>
            )}
            <ZipArchivePreview
              tree={model.archiveTree ?? []}
              treeLabel={archiveContentsLabel(model.archiveFormat)}
              onExtract={
                !zen && model.archiveFormat === 'zip' && onExtractZip
                  ? () => onExtractZip([model.path])
                  : undefined
              }
            />
          </>
        )}
        {model.kind === 'chm' && (
          <ChmPreview
            chmPath={model.path}
            tree={model.archiveTree ?? []}
            initialMediaUrl={model.mediaUrl}
          />
        )}
        {model.kind === 'shortcut' && (
          <div className="preview-shortcut">
            <div className="preview-icon">
              <FileIcon size={56} />
            </div>
            {!zen ? <div className="preview-shortcut-caption">Windows shortcut</div> : null}
            {(() => {
              const target = model.fields.find((f) => f.id === 'lnk.target')?.value
              if (!target) return null
              return <div className="preview-shortcut-target mono">{target}</div>
            })()}
            {!zen ? (
              <div className="preview-shortcut-actions">
                <button className="btn" onClick={() => onOpenPath(model.path)}>
                  Open shortcut
                </button>
                {(() => {
                  const target = model.fields.find((f) => f.id === 'lnk.target')?.value
                  const kind = model.fields.find((f) => f.id === 'lnk.targetKind')?.value ?? ''
                  if (!target || kind.includes('URL') || kind.includes('Missing')) return null
                  return (
                    <button className="btn" onClick={() => onOpenPath(target)}>
                      Open target
                    </button>
                  )
                })()}
              </div>
            ) : null}
          </div>
        )}
        {model.kind === 'pdf' && !model.mediaUrl && (
          <>
            <div className="preview-icon">
              <PdfFileIcon size={56} />
            </div>
            {!zen ? (
              <div style={{ textAlign: 'center', paddingBottom: 8 }}>
                <button className="btn" onClick={() => onOpenPath(model.path)}>
                  Open with default app
                </button>
              </div>
            ) : null}
          </>
        )}
        {model.kind === 'missing' && <div className="preview-empty">File no longer exists</div>}
        </div>

        {!zen && model.warnings && model.warnings.length > 0 && (
          <div className="preview-warnings">{model.warnings.join(' · ')}</div>
        )}

        {!zen ? (
          <PreviewMetaTabs
            hasFile={hasRichFields}
            file={
              <div className={`preview-fields${model.kind === 'binary' ? ' preview-fields-flush' : ''}`}>
                {CONTENT_GROUPS.map(({ key, label }) => {
                  const fields = contentFields.filter((f) => (f.group ?? 'other') === key)
                  if (fields.length === 0) return null
                  const groupLabel =
                    key === 'generation' && model.subtitle?.startsWith('SafeTensors')
                      ? 'Training'
                      : key === 'other' && model.subtitle?.startsWith('SafeTensors')
                        ? 'Weights'
                        : key === 'other' && model.subtitle === '3ds Max UVW map'
                          ? 'UVW map'
                          : key === 'other' && model.subtitle === 'Radiance HDR'
                            ? 'HDR'
                            : label
                  return (
                    <div key={key}>
                      <div className="preview-group-title">{groupLabel}</div>
                      {key === 'generation' ? (
                        <GenerationFields fields={fields} onCopy={onCopy} />
                      ) : (
                        <CompactableFields fields={fields} onCopy={onCopy} />
                      )}
                    </div>
                  )
                })}
              </div>
            }
            onCopy={onCopy}
          />
        ) : null}
      </div>

      {!zen && fileFields.length > 0 && <DetailsStrip fields={fileFields} onCopy={onCopy} />}
    </MediaMetadataProvider>
  )
}

function PreviewMetaTabs({
  hasFile,
  file,
  onCopy
}: {
  hasFile: boolean
  file: ReactNode
  onCopy: (value: string) => Promise<void>
}): JSX.Element | null {
  const media = useMediaMetadata()
  const hasMedia = !!media && mediaMetadataHasDetails(media.meta)
  const [tab, setTab] = useState<'media' | 'file'>('media')
  if (!hasMedia && !hasFile) return null
  const showTabs = hasMedia && hasFile
  const active = showTabs ? tab : hasMedia ? 'media' : 'file'

  return (
    <div className="preview-meta">
      {showTabs ? (
        <div className="preview-meta-tabs" role="tablist" aria-label="Preview metadata">
          <button
            type="button"
            role="tab"
            aria-selected={active === 'media'}
            className={`preview-source-tab${active === 'media' ? ' active' : ''}`}
            onClick={() => setTab('media')}
          >
            Media
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={active === 'file'}
            className={`preview-source-tab${active === 'file' ? ' active' : ''}`}
            onClick={() => setTab('file')}
          >
            File
          </button>
        </div>
      ) : null}
      {active === 'media' ? <MediaMetadataDetails onCopy={onCopy} /> : file}
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

function fieldIdTail(id: string): string {
  const i = id.lastIndexOf('.')
  return i >= 0 ? id.slice(i + 1) : id
}

/** Titles, comments, and other values that should keep a full-width boxed row. */
const BLOCK_FIELD_TAILS = new Set([
  'title',
  'artists',
  'artist',
  'album',
  'albumArtist',
  'genre',
  'comment',
  'description',
  'lyrics',
  'copyright',
  'synopsis',
  'prompt',
  'negative',
  'rawParameters',
  'comfyPromptJson',
  'comfyWorkflowJson',
  'subject',
  'from',
  'to',
  'body',
  'target',
  'args',
  'workingDir'
])

function isCompactPreviewField(f: PreviewField): boolean {
  if (f.syntax === 'json' || f.mono) return false
  if (f.value.includes('\n')) return false
  const tail = fieldIdTail(f.id)
  if (BLOCK_FIELD_TAILS.has(tail)) return false
  if (f.id.toLowerCase().includes('json')) return false
  return f.value.length <= 28
}

function CompactableFields({
  fields,
  onCopy
}: {
  fields: PreviewField[]
  onCopy(v: string): Promise<void>
}): JSX.Element {
  const chunks: Array<
    { type: 'flow'; items: PreviewField[] } | { type: 'block'; item: PreviewField }
  > = []
  let flow: PreviewField[] = []
  const flushFlow = (): void => {
    if (flow.length === 1) chunks.push({ type: 'block', item: flow[0]! })
    else if (flow.length > 1) chunks.push({ type: 'flow', items: flow })
    flow = []
  }
  for (const f of fields) {
    if (isCompactPreviewField(f)) flow.push(f)
    else {
      flushFlow()
      chunks.push({ type: 'block', item: f })
    }
  }
  flushFlow()

  return (
    <>
      {chunks.map((c) =>
        c.type === 'flow' ? (
          <div key={c.items.map((f) => f.id).join('|')} className="preview-field-flow">
            {c.items.map((f) => (
              <Field key={f.id} field={f} onCopy={onCopy} compact />
            ))}
          </div>
        ) : (
          <Field key={c.item.id} field={c.item} onCopy={onCopy} />
        )
      )}
    </>
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
