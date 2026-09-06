/** Session-only clipboard for Copy/Paste user metadata (not the OS clipboard). */

export type UserMetadataClipboardPayload = {
  setId: string
  values: Record<string, unknown>
}

let payload: UserMetadataClipboardPayload | null = null

export function getUserMetadataClipboard(): UserMetadataClipboardPayload | null {
  return payload
}

export function setUserMetadataClipboard(next: UserMetadataClipboardPayload | null): void {
  payload = next
}

export function clearUserMetadataClipboard(): void {
  payload = null
}
