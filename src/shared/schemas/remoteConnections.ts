import { z } from 'zod'

export const remoteProtocolSchema = z.enum(['sftp', 'ftps', 'ftp'])
export type RemoteProtocol = z.infer<typeof remoteProtocolSchema>

export const remoteConnectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  protocol: remoteProtocolSchema,
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1).max(128),
  /** Remote POSIX start path (e.g. `/` or `/home/demo`). */
  startPath: z.string().min(1).catch('/'),
  /** Required true when protocol is cleartext `ftp`. */
  insecureFtpAck: z.boolean().catch(false),
  /** TOFU host-key / cert fingerprint (hex or base64), when known. */
  hostFingerprint: z.string().nullable().catch(null),
  /** True when a password is stored in safeStorage (never the secret itself). */
  hasPassword: z.boolean().catch(false),
  updatedAt: z.number().int().catch(() => Date.now())
})

export type RemoteConnection = z.infer<typeof remoteConnectionSchema>

export const remoteConnectionsFileSchema = z.object({
  version: z.literal(1).catch(1),
  connections: z.array(remoteConnectionSchema).catch([])
})

export type RemoteConnectionsFile = z.infer<typeof remoteConnectionsFileSchema>

export const DEFAULT_REMOTE_PORTS: Record<RemoteProtocol, number> = {
  sftp: 22,
  ftps: 990,
  ftp: 21
}

/** Public test presets for the Add dialog (not auto-saved). */
export type RemoteTestPreset = {
  id: string
  label: string
  protocol: RemoteProtocol
  host: string
  port: number
  username: string
  password: string
  startPath: string
  insecureFtpAck: boolean
  note: string
}

export const REMOTE_TEST_PRESETS: RemoteTestPreset[] = [
  {
    id: 'rebex-sftp',
    label: 'Rebex SFTP (read-only)',
    protocol: 'sftp',
    host: 'test.rebex.net',
    port: 22,
    username: 'demo',
    password: 'password',
    startPath: '/',
    insecureFtpAck: false,
    note: 'Read-only demo. Cannot upload or delete.'
  },
  {
    id: 'rebex-ftp',
    label: 'Rebex FTP (read-only)',
    protocol: 'ftp',
    host: 'test.rebex.net',
    port: 21,
    username: 'demo',
    password: 'password',
    startPath: '/',
    insecureFtpAck: true,
    note: 'Cleartext FTP — read-only demo.'
  },
  {
    id: 'tele2-ftp',
    label: 'Tele2 speedtest FTP',
    protocol: 'ftp',
    host: 'speedtest.tele2.net',
    port: 21,
    username: 'anonymous',
    password: 'anonymous@',
    startPath: '/',
    insecureFtpAck: true,
    note: 'Anonymous; uploads only under upload/.'
  },
  {
    id: 'wing-sftp',
    label: 'Wing FTP demo SFTP',
    protocol: 'sftp',
    host: 'demo.wftpserver.com',
    port: 2222,
    username: 'demo',
    password: 'demo',
    startPath: '/',
    insecureFtpAck: false,
    note: 'Live interactive demo (SFTP on 2222).'
  },
  {
    id: 'wing-ftps',
    label: 'Wing FTP demo FTPS',
    protocol: 'ftps',
    host: 'demo.wftpserver.com',
    port: 990,
    username: 'demo',
    password: 'demo',
    startPath: '/',
    insecureFtpAck: false,
    note: 'Live interactive demo (implicit FTPS).'
  },
  {
    id: 'wing-ftp',
    label: 'Wing FTP demo FTP',
    protocol: 'ftp',
    host: 'demo.wftpserver.com',
    port: 21,
    username: 'demo',
    password: 'demo',
    startPath: '/',
    insecureFtpAck: true,
    note: 'Live interactive demo (cleartext FTP).'
  }
]
