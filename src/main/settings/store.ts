import path from 'node:path'
import { app } from 'electron'
import {
  settingsSchema,
  defaultSettings,
  settingsPatchSchema,
  type Settings
} from '@shared/schemas/settings'
import { JsonStore } from '../store/jsonStore'

let store: JsonStore<Settings> | null = null

export function settingsStore(): JsonStore<Settings> {
  if (!store) {
    store = new JsonStore(
      path.join(app.getPath('userData'), 'settings.json'),
      settingsSchema,
      defaultSettings
    )
  }
  return store
}

/** Always re-parse through the live schema so new keys survive HMR / evolution. */
export function getSettings(): Settings {
  return settingsSchema.parse(settingsStore().get())
}

export function patchSettings(patch: unknown): Settings {
  const parsed = settingsPatchSchema.parse(patch)
  const cur = settingsStore().get()
  const next = settingsSchema.parse({
    ...cur,
    ...parsed,
    slideshow: parsed.slideshow
      ? { ...defaultSettings.slideshow, ...cur.slideshow, ...parsed.slideshow }
      : (cur.slideshow ?? defaultSettings.slideshow),
    contextMenu: parsed.contextMenu
      ? {
          ...defaultSettings.contextMenu,
          ...cur.contextMenu,
          ...parsed.contextMenu,
          files: parsed.contextMenu.files ?? cur.contextMenu?.files ?? [],
          folders: parsed.contextMenu.folders ?? cur.contextMenu?.folders ?? []
        }
      : (cur.contextMenu ?? defaultSettings.contextMenu)
  })
  settingsStore().replace(next)
  // Settings toggles should hit disk immediately (don’t wait for debounce / quit).
  settingsStore().flush()
  // D34: optional search HTTP API follows settings.
  if (
    'searchHttpEnabled' in parsed ||
    'searchHttpPort' in parsed ||
    'searchHttpToken' in parsed
  ) {
    void import('../search/httpServer').then((m) => m.syncSearchHttpServer())
  }
  return next
}
