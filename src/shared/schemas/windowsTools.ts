import { z } from 'zod'

/** Allowlisted This PC / MMC tools — never arbitrary ShellExecute. */
export const WINDOWS_TOOL_IDS = [
  'computer-manager',
  'device-manager',
  'control-panel',
  'this-pc-properties'
] as const

export type WindowsToolId = (typeof WINDOWS_TOOL_IDS)[number]

export const windowsToolIdSchema = z.enum(WINDOWS_TOOL_IDS)

export const openWindowsToolRequestSchema = z.object({
  id: windowsToolIdSchema
})
