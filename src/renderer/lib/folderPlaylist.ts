/**
 * Folder/cache slideshow playlist — kept OUT of Zustand so index advances stay O(1).
 * A 100k path array in reactive state makes every set()/re-render drag the heap.
 * Prefer sharing the same string[] reference with the image-list cache (no copy).
 */
import {
  slideshowFirstIndex,
  slideshowLastIndex,
  slideshowLength,
  slideshowNextIndex,
  type SlideshowPlaylistCursor
} from '@shared/slideshow/playlist'

let paths: string[] = []
let skipped = new Set<number>()

export function setFolderPlaylist(next: string[]): void {
  paths = next
  skipped = new Set()
}

export function clearFolderPlaylist(): void {
  paths = []
  skipped = new Set()
}

export function folderPlaylistCursor(): SlideshowPlaylistCursor {
  return { paths, skipped }
}

export function folderPathAt(index: number): string | null {
  return paths[index] ?? null
}

export function folderPlaylistPhysicalLength(): number {
  return paths.length
}

export function folderPlaylistLiveLength(): number {
  return slideshowLength({ paths, skipped })
}

export function folderPlaylistMarkSkipped(index: number): void {
  skipped.add(index)
}

export function folderPlaylistUnskip(index: number): void {
  skipped.delete(index)
}

export function folderPlaylistSkippedSize(): number {
  return skipped.size
}

export function folderPlaylistNextIndex(
  from: number,
  dir: 1 | -1,
  loop: boolean
): number | null {
  return slideshowNextIndex({ paths, skipped }, from, dir, loop)
}

export function folderPlaylistFirstIndex(): number | null {
  return slideshowFirstIndex({ paths, skipped })
}

export function folderPlaylistLastIndex(): number | null {
  return slideshowLastIndex({ paths, skipped })
}
