import { useAppStore } from '@renderer/store/appStore'
import type { CSSProperties, JSX } from 'react'

type IconProps = { size?: number; className?: string; style?: CSSProperties }

function svg(path: JSX.Element, viewBox = '0 0 24 24') {
  return function Icon({ size, className, style }: IconProps): JSX.Element {
    // Explicit `size` = fixed slot (tree/list/preview). Omitted = chrome scale (toolbar)
    // via settings.iconSizePx. Secondary windows may lack settings before boot.
    const resolved =
      size !== undefined ? size : (useAppStore.getState().settings?.iconSizePx ?? 16)
    return (
      <svg
        width={resolved}
        height={resolved}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
        aria-hidden="true"
      >
        {path}
      </svg>
    )
  }
}

export const FolderIcon = svg(
  <path
    d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
    fill="var(--folder-fill, #e8b64c)"
    stroke="none"
  />
)
export const FileIcon = svg(
  <>
    <path d="M6 2h8l4 4v16H6z" fill="var(--file-fill, #8b94a6)" stroke="none" />
    <path d="M14 2v4h4" stroke="var(--bg, #12141a)" strokeWidth="1.4" fill="none" />
  </>
)
export const ImageFileIcon = svg(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" fill="#5aa564" stroke="none" />
    <circle cx="9" cy="10" r="1.8" fill="#e8eaef" stroke="none" />
    <path d="M4 18l5-5 3 3 4-4 4 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="#397a42" stroke="none" />
  </>
)
export const TextFileIcon = svg(
  <>
    <path d="M6 2h8l4 4v16H6z" fill="#6d87c4" stroke="none" />
    <path d="M9 11h6M9 14h6M9 17h4" stroke="#e8eaef" strokeWidth="1.4" />
  </>
)
export const CodeFileIcon = svg(
  <>
    <path d="M6 2h8l4 4v16H6z" fill="#9a6dc4" stroke="none" />
    <path d="M10 11l-2 3 2 3M14 11l2 3-2 3" stroke="#e8eaef" strokeWidth="1.4" fill="none" />
  </>
)
export const AudioFileIcon = svg(
  <>
    <path d="M6 2h8l4 4v16H6z" fill="#c46d9a" stroke="none" />
    <path d="M10 16.5V10l5-1v6.5" stroke="#e8eaef" strokeWidth="1.4" fill="none" />
    <circle cx="9" cy="16.5" r="1.4" fill="#e8eaef" stroke="none" />
    <circle cx="14" cy="15.5" r="1.4" fill="#e8eaef" stroke="none" />
  </>
)
export const VideoFileIcon = svg(
  <>
    <path d="M6 2h8l4 4v16H6z" fill="#c4996d" stroke="none" />
    <path d="M10 10.5v7l6-3.5z" fill="#e8eaef" stroke="none" />
  </>
)
export const PdfFileIcon = svg(
  <>
    <path d="M6 2h8l4 4v16H6z" fill="#c45b5b" stroke="none" />
    <path d="M9 12h6M9 15h6" stroke="#e8eaef" strokeWidth="1.4" />
  </>
)
export const ArchiveFileIcon = svg(
  <>
    <path d="M6 2h8l4 4v16H6z" fill="#a6935c" stroke="none" />
    <path d="M11 4h2v2h-2zM11 8h2v2h-2zM11 12h2v2h-2z" fill="#e8eaef" stroke="none" />
  </>
)
export const ExeFileIcon = svg(
  <>
    <path d="M6 2h8l4 4v16H6z" fill="#5c8ba6" stroke="none" />
    <path d="M9 12l2 2.5-2 2.5M13 17h3" stroke="#e8eaef" strokeWidth="1.4" fill="none" />
  </>
)
export const DriveIcon = svg(
  <>
    <rect x="3" y="9" width="18" height="8" rx="2" fill="#8b94a6" stroke="none" />
    <circle cx="17.5" cy="13" r="1.2" fill="#12141a" stroke="none" />
  </>
)
export const HomeIcon = svg(<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />)
export const ChevronRight = svg(<path d="M9 6l6 6-6 6" />)
export const ChevronLeft = svg(<path d="M15 6l-6 6 6 6" />)
export const ChevronDown = svg(<path d="M6 9l6 6 6-6" />)
export const ArrowLeft = svg(<path d="M19 12H5m6-7l-7 7 7 7" />)
export const ArrowRight = svg(<path d="M5 12h14m-6-7l7 7-7 7" />)
export const ArrowUp = svg(<path d="M12 19V5m-7 6l7-7 7 7" />)
export const RefreshIcon = svg(<path d="M20 11a8 8 0 1 0-2.3 6.3M20 5v6h-6" />)
export const CloseIcon = svg(<path d="M6 6l12 12M18 6L6 18" />)
export const EditImageIcon = svg(
  <>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </>
)
export const PlusIcon = svg(<path d="M12 5v14M5 12h14" />)
export const RecycleBinIcon = svg(
  <>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v6M14 11v6" />
  </>
)
export const SearchIcon = svg(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.5-4.5" />
  </>
)
/** Advanced / power search builder. */
export const SlidersIcon = svg(
  <>
    <path d="M4 6h16M4 12h10M4 18h6" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="12" cy="18" r="2" />
  </>
)
export const CopyIcon = svg(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </>
)
export const CutIcon = svg(
  <>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <path d="M20 4L8.5 13.5M20 20L8.5 10.5" />
  </>
)
export const PasteIcon = svg(
  <>
    <path d="M8 4h2a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2h2a1 1 0 0 1 1 1v3H7V5a1 1 0 0 1 1-1z" />
    <rect x="5" y="8" width="14" height="13" rx="2" />
  </>
)
export const UndoIcon = svg(<path d="M9 14L4 9l5-5M4 9h10a5 5 0 1 1 0 10h-3" />)
export const RedoIcon = svg(<path d="M15 14l5-5-5-5M20 9H10a5 5 0 1 0 0 10h3" />)
export const TrashIcon = svg(
  <>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v6M14 11v6" />
  </>
)
/** Marquee / “select everything” — distinct from LayoutsIcon’s 2×2 tiles. */
export const SelectAllIcon = svg(
  <>
    <rect
      x="4"
      y="4"
      width="16"
      height="16"
      rx="2"
      strokeDasharray="3 2"
    />
    <path d="M8 12l2.5 2.5L16 9" />
  </>
)
/** Double chevron-up — collapse every expanded folder-tree branch. */
export const CollapseAllIcon = svg(
  <>
    <path d="M7 11l5-5 5 5" />
    <path d="M7 18l5-5 5 5" />
  </>
)
export const SettingsIcon = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
)
export const PanelIcon = svg(
  <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </>
)
/** Named workspace layouts (tabs + chrome). */
export const LayoutsIcon = svg(
  <>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </>
)
export const SpinnerIcon = svg(<path d="M21 12a9 9 0 1 1-6.2-8.6" />)
export const EyeIcon = svg(
  <>
    <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" />
    <circle cx="12" cy="12" r="2.6" />
  </>
)
export const EyeOffIcon = svg(
  <>
    <path d="M2 12s3.5-6.5 10-6.5c2 0 3.7.6 5.2 1.5M22 12s-3.5 6.5-10 6.5c-2 0-3.7-.6-5.2-1.5" />
    <path d="M4 20L20 4" />
  </>
)

const CODE_EXTS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'py',
  'rb',
  'rs',
  'go',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'shader',
  'php',
  'sh',
  'ps1',
  'psm1',
  'psd1',
  'ps',
  'bat',
  'cmd',
  'vbs',
  'vbe',
  'sql',
  'html',
  'htm',
  'css',
  'scss',
  'vue',
  'svelte',
  'lua',
  'xml',
  'ffs_gui'
])
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'jfif',
  'webp',
  'gif',
  'bmp',
  'avif',
  'tiff',
  'tif',
  'tga',
  'hdr',
  'svg',
  'ico',
  'psd'
])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma', 'opus'])
const VIDEO_EXTS = new Set([
  'mp4',
  'mkv',
  'webm',
  'avi',
  'divx',
  'mov',
  'wmv',
  'm4v',
  'mpg',
  'mpeg',
  'flv',
  'rmvb',
  'rm'
])
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'wlt',
  'meta',
  'mat',
  'asset',
  'terrainlayer',
  'lighting',
  'unity',
  'prefab',
  'controller',
  'anim',
  'shadergraph',
  'mtl',
  'csproj',
  'sln',
  'vsconfig',
  'csv',
  'tsv',
  'log',
  'srt',
  'sub',
  'smi',
  'sami',
  'ics',
  'ical',
  'eml',
  'ini',
  'cfg',
  'toml'
])
const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'cab'])
const EXE_EXTS = new Set(['exe', 'msi', 'dll', 'com', 'app'])

export const PlayIcon = svg(<path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />)
/** Second slideshow control — compiled file lists. */
export const CompiledListsPlayIcon = svg(
  <>
    <rect x="3" y="4" width="7" height="7" rx="1" />
    <rect x="14" y="4" width="7" height="7" rx="1" />
    <rect x="3" y="13" width="7" height="7" rx="1" />
    <path d="M15 15l6 3.5L15 22v-7z" fill="currentColor" stroke="none" />
  </>
)
export const ListPlusIcon = svg(
  <>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </>
)
export const SaveIcon = svg(
  <>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </>
)
export const FolderOpenIcon = svg(
  <path d="M5 4h5l2 2h7a2 2 0 0 1 2 2v1H4V6a2 2 0 0 1 2-2zm-1 5h18l-1.5 10H5.5L4 9z" />
)
export const ScriptIcon = svg(
  <>
    <path d="M8 4h8a2 2 0 0 1 2 2v14l-4-2-4 2V6a2 2 0 0 1 2-2z" />
    <path d="M10 9h4M10 13h4" />
  </>
)
export const EraserIcon = svg(
  <>
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
  </>
)
/** Enter Zen mode (preview only). */
export const ExpandIcon = svg(
  <>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="M21 3l-7 7" />
    <path d="M3 21l7-7" />
  </>
)
/** Exit Zen mode. */
export const CompressIcon = svg(
  <>
    <path d="M4 14h6v6" />
    <path d="M20 10h-6V4" />
    <path d="M14 10l7-7" />
    <path d="M3 21l7-7" />
  </>
)
/** Word wrap on/off in text preview. */
export const WrapTextIcon = svg(
  <>
    <path d="M3 6h18" />
    <path d="M3 12h13a3 3 0 0 1 0 6h-5" />
    <path d="M8 15l-3 3 3 3" />
  </>
)
/** Detach the preview pane into a peer window. */
export const PopOutIcon = svg(
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6" />
    <path d="M10 14L21 3" />
  </>
)

const MODEL3D_EXTS = new Set(['obj', 'fbx', '3ds'])

export const Model3dFileIcon = svg(
  <>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </>
)

export function iconForEntry(ext: string, isDir: boolean): (props: IconProps) => JSX.Element {
  if (isDir) return FolderIcon
  if (MODEL3D_EXTS.has(ext)) return Model3dFileIcon
  if (IMAGE_EXTS.has(ext)) return ImageFileIcon
  if (AUDIO_EXTS.has(ext)) return AudioFileIcon
  if (VIDEO_EXTS.has(ext)) return VideoFileIcon
  if (ext === 'pdf') return PdfFileIcon
  if (CODE_EXTS.has(ext)) return CodeFileIcon
  if (TEXT_EXTS.has(ext)) return TextFileIcon
  if (ARCHIVE_EXTS.has(ext)) return ArchiveFileIcon
  if (EXE_EXTS.has(ext)) return ExeFileIcon
  return FileIcon
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext) && ext !== 'svg' && ext !== 'ico'
}

export function isVideoExt(ext: string): boolean {
  return VIDEO_EXTS.has(ext.toLowerCase())
}

export function isAudioExt(ext: string): boolean {
  return AUDIO_EXTS.has(ext.toLowerCase())
}
