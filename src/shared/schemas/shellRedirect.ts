import { z } from 'zod'

export const shellRedirectStatusSchema = z.enum([
  'disabled',
  'enabled',
  'drifted',
  'missingLauncher',
  'restoreRequired'
])
export type ShellRedirectStatus = z.infer<typeof shellRedirectStatusSchema>

export const shellRedirectInvocationActionSchema = z.enum([
  'mfe-open',
  'mfe-reveal',
  'explorer-fallback',
  'error'
])
export type ShellRedirectInvocationAction = z.infer<typeof shellRedirectInvocationActionSchema>

export const shellRedirectInvocationSchema = z.object({
  timestamp: z.string(),
  verb: z.string(),
  target: z.string(),
  action: shellRedirectInvocationActionSchema,
  launcherVersion: z.string().optional()
})
export type ShellRedirectInvocation = z.infer<typeof shellRedirectInvocationSchema>

export const shellRedirectGetStatusResponseSchema = z.object({
  status: shellRedirectStatusSchema,
  active: z.boolean(),
  userRequested: z.boolean(),
  /** False when MfeShellLauncher.exe is not on disk at launcherPath. */
  launcherExists: z.boolean(),
  activeKeys: z.array(z.string()),
  launcherPath: z.string(),
  installPath: z.string(),
  invocationCount: z.number().int().nonnegative(),
  lastInvocation: shellRedirectInvocationSchema.nullable().optional()
})
export type ShellRedirectGetStatusResponse = z.infer<typeof shellRedirectGetStatusResponseSchema>

export const shellRedirectReadInvocationsRequestSchema = z.object({
  limit: z.number().int().positive().max(100).optional()
})
export type ShellRedirectReadInvocationsRequest = z.infer<
  typeof shellRedirectReadInvocationsRequestSchema
>

export const shellRedirectReadInvocationsResponseSchema = z.object({
  invocations: z.array(shellRedirectInvocationSchema)
})
export type ShellRedirectReadInvocationsResponse = z.infer<
  typeof shellRedirectReadInvocationsResponseSchema
>

export const shellRedirectTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional()
})
export type ShellRedirectTestResponse = z.infer<typeof shellRedirectTestResponseSchema>

export const shellRedirectMutateResponseSchema = z.object({
  status: shellRedirectStatusSchema,
  active: z.boolean(),
  userRequested: z.boolean()
})
export type ShellRedirectMutateResponse = z.infer<typeof shellRedirectMutateResponseSchema>
