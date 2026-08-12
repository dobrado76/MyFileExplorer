import { z } from 'zod'
import { remoteProtocolSchema } from './remoteConnections'

export const remoteUpsertRequestSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  protocol: remoteProtocolSchema,
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(128),
  startPath: z.string().min(1).optional(),
  insecureFtpAck: z.boolean().optional(),
  password: z.string().nullable().optional(),
  clearFingerprint: z.boolean().optional()
})

export const remoteIdRequestSchema = z.object({
  id: z.string().min(1)
})

export const remoteRenameRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120)
})
