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

export function patchSettings(patch: unknown): Settings {
  const parsed = settingsPatchSchema.parse(patch)
  const next = { ...settingsStore().get(), ...parsed }
  return settingsStore().set(next)
}
