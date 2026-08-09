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
  // Parse with the module’s current schema (not a schema frozen into JsonStore
  // at first construction — that drops newly added keys like previewVideoAutoplay).
  const next = settingsSchema.parse({ ...settingsStore().get(), ...parsed })
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
