import path from 'node:path'
import { app } from 'electron'
import { sessionSchema, defaultSession, type SessionState } from '@shared/schemas/session'
import { JsonStore } from '../store/jsonStore'

let store: JsonStore<SessionState> | null = null

export function sessionStore(): JsonStore<SessionState> {
  if (!store) {
    store = new JsonStore(
      path.join(app.getPath('userData'), 'session.json'),
      sessionSchema,
      defaultSession
    )
  }
  return store
}
