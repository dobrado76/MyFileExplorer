import { z } from 'zod'

export const networkHostSchema = z.object({
  name: z.string().min(1),
  /** `\\HOST` */
  unc: z.string().min(1)
})
export type NetworkHost = z.infer<typeof networkHostSchema>

export const networkShareSchema = z.object({
  name: z.string().min(1),
  /** `\\HOST\Share` */
  unc: z.string().min(1),
  remark: z.string().optional()
})
export type NetworkShare = z.infer<typeof networkShareSchema>

export const networkDiscoveryStatusSchema = z.enum(['idle', 'running', 'done', 'error'])
export type NetworkDiscoveryStatus = z.infer<typeof networkDiscoveryStatusSchema>

export const networkListSharesRequestSchema = z.object({
  server: z.string().min(1)
})

export const networkDiscoveryEventSchema = z.object({
  generation: z.number().int().nonnegative(),
  status: z.enum(['running', 'done', 'error']),
  hosts: z.array(networkHostSchema).optional(),
  message: z.string().optional()
})
export type NetworkDiscoveryEvent = z.infer<typeof networkDiscoveryEventSchema>
