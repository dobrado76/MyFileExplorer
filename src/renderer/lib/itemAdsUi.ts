import { isRemoteLocation } from '@shared/remotePaths'

export function itemAdsAvailable(
  platform: string,
  path: string | null | undefined,
  recycleActive: boolean
): boolean {
  if (platform !== 'win32' || recycleActive || !path) return false
  return !isRemoteLocation(path)
}
