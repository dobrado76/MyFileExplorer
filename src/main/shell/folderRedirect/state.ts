import fs from 'node:fs'
import { shellRedirectStatePath } from './paths'

export type ShellRedirectLocalState = {
  userRequestedEnabled: boolean
}

const DEFAULT_STATE: ShellRedirectLocalState = { userRequestedEnabled: false }

export function readShellRedirectState(): ShellRedirectLocalState {
  try {
    const raw = fs.readFileSync(shellRedirectStatePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ShellRedirectLocalState>
    return {
      userRequestedEnabled: parsed.userRequestedEnabled === true
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function writeShellRedirectState(state: ShellRedirectLocalState): void {
  fs.writeFileSync(shellRedirectStatePath(), JSON.stringify(state, null, 2), 'utf8')
}

export function setUserRequestedEnabled(enabled: boolean): void {
  writeShellRedirectState({ userRequestedEnabled: enabled })
}
