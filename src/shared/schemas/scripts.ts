import { z } from 'zod'

export const SCRIPT_LANGUAGES = ['powershell', 'python', 'cmd', 'bash'] as const
export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number]

export const scriptLanguageSchema = z.enum(SCRIPT_LANGUAGES)

export const SCRIPT_SCOPES = ['folder', 'selection', 'global'] as const
export type ScriptScope = (typeof SCRIPT_SCOPES)[number]

export const scriptScopeSchema = z.enum(SCRIPT_SCOPES)

export const SCRIPT_RUN_MODES = ['folder', 'selection', 'global'] as const
export type ScriptRunMode = (typeof SCRIPT_RUN_MODES)[number]

export const scriptRunModeSchema = z.enum(SCRIPT_RUN_MODES)

export const SCRIPT_PARAM_TYPES = [
  'string',
  'int',
  'float',
  'bool',
  'file',
  'folder',
  'choice'
] as const
export type ScriptParamType = (typeof SCRIPT_PARAM_TYPES)[number]

export const scriptParameterSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, 'Parameter names must be letters, digits, _ or -'),
  label: z.string().min(1).max(80).catch(''),
  type: z.enum(SCRIPT_PARAM_TYPES),
  required: z.boolean().catch(false),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  choices: z.array(z.string().min(1).max(120)).max(40).catch([])
})

export type ScriptParameter = z.infer<typeof scriptParameterSchema>

export const scriptDefinitionSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).catch(''),
  language: scriptLanguageSchema,
  /** `auto` = detect from PATH / settings overrides. Otherwise an absolute interpreter path. */
  interpreter: z.string().min(1).max(500).catch('auto'),
  scopes: z.array(scriptScopeSchema).min(1).catch(['folder']),
  recursive: z.boolean().catch(false),
  parameters: z.array(scriptParameterSchema).max(24).catch([]),
  contextMenuEnabled: z.boolean().catch(true),
  destructive: z.boolean().catch(false),
  dryRunSupported: z.boolean().catch(false),
  sourceKind: z.enum(['managed', 'external']).catch('managed'),
  externalPath: z.string().max(1000).optional(),
  category: z.string().max(80).catch(''),
  /** Empty = any extension (selection scope). */
  matchExtensions: z.array(z.string().min(1).max(20)).max(40).catch([]),
  minSelection: z.number().int().min(0).max(10_000).catch(0),
  dependencies: z.array(z.string().min(1).max(120)).max(40).catch([]),
  createdAt: z.string().catch(''),
  updatedAt: z.string().catch('')
})

export type ScriptDefinition = z.infer<typeof scriptDefinitionSchema>

export function isGlobalScript(script: Pick<ScriptDefinition, 'scopes'> | null | undefined): boolean {
  return Array.isArray(script?.scopes) && script.scopes.includes('global')
}

/** Global is exclusive of folder/selection. */
export function normalizeScriptScopes(scopes: ScriptScope[] | null | undefined): ScriptScope[] {
  const list = Array.isArray(scopes) ? scopes : []
  if (list.includes('global')) return ['global']
  const next = list.filter((s): s is 'folder' | 'selection' => s === 'folder' || s === 'selection')
  return next.length > 0 ? next : ['folder']
}

export function applyGlobalScriptRules<T extends ScriptDefinition>(script: T): T {
  if (!isGlobalScript(script)) return { ...script, scopes: normalizeScriptScopes(script.scopes) }
  return {
    ...script,
    scopes: ['global'],
    recursive: false,
    contextMenuEnabled: false,
    matchExtensions: [],
    minSelection: 0
  }
}

export const scriptLibraryFileSchema = z.object({
  version: z.literal(1).catch(1),
  scripts: z.array(scriptDefinitionSchema).catch([])
})

export type ScriptLibraryFile = z.infer<typeof scriptLibraryFileSchema>

export const scriptParamValueSchema = z.union([z.string(), z.number(), z.boolean()])

export const scriptRunRequestSchema = z.object({
  runId: z.string().min(1).max(80),
  /** Library script. Omit for ad-hoc source. */
  scriptId: z.string().min(1).max(80).optional(),
  language: scriptLanguageSchema.optional(),
  source: z.string().max(2_000_000).optional(),
  interpreter: z.string().max(500).optional(),
  mode: scriptRunModeSchema,
  root: z.string().max(1000).optional(),
  paths: z.array(z.string().min(1).max(1000)).max(100_000).optional(),
  recursive: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  params: z.record(z.string(), scriptParamValueSchema).optional()
})

export type ScriptRunRequest = z.infer<typeof scriptRunRequestSchema>

export const scriptCancelRequestSchema = z.object({
  runId: z.string().min(1).max(80)
})

export const scriptIdRequestSchema = z.object({
  id: z.string().min(1).max(80)
})

export const scriptUpsertRequestSchema = z.object({
  script: scriptDefinitionSchema.partial({ id: true, createdAt: true, updatedAt: true }),
  source: z.string().max(2_000_000)
})

export const scriptDuplicateRequestSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120).optional()
})

export const MFESCRIPT_FORMAT = 'myfileexplorer-script' as const
export const MFESCRIPT_FORMAT_VERSION = 1 as const

export const mfeScriptDocumentSchema = z.object({
  format: z.literal(MFESCRIPT_FORMAT),
  formatVersion: z.literal(MFESCRIPT_FORMAT_VERSION).or(z.number().int().positive()),
  exportedAt: z.string().optional(),
  script: scriptDefinitionSchema.omit({ id: true, createdAt: true, updatedAt: true }).partial({
    sourceKind: true,
    externalPath: true
  }),
  source: z.string().max(2_000_000)
})

export type MfeScriptDocument = z.infer<typeof mfeScriptDocumentSchema>

export const scriptImportRequestSchema = z.object({
  json: z.string().max(2_500_000)
})

export const scriptExportRequestSchema = z.object({
  id: z.string().min(1).max(80)
})

export const scriptSetExternalRequestSchema = z.object({
  id: z.string().min(1).max(80),
  path: z.string().min(1).max(1000)
})

export function scriptFileExtension(language: ScriptLanguage): string {
  switch (language) {
    case 'powershell':
      return '.ps1'
    case 'python':
      return '.py'
    case 'cmd':
      return '.cmd'
    case 'bash':
      return '.sh'
  }
}

export function languageFromExtension(filePath: string): ScriptLanguage | null {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.ps1')) return 'powershell'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.bat') || lower.endsWith('.cmd')) return 'cmd'
  if (lower.endsWith('.sh')) return 'bash'
  return null
}

export function newScriptId(): string {
  return `scr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export const defaultScriptDefinition = (): Omit<
  ScriptDefinition,
  'id' | 'createdAt' | 'updatedAt'
> => ({
  name: 'New script',
  description: '',
  language: 'powershell',
  interpreter: 'auto',
  scopes: ['folder'],
  recursive: false,
  parameters: [],
  contextMenuEnabled: true,
  destructive: false,
  dryRunSupported: false,
  sourceKind: 'managed',
  category: '',
  matchExtensions: [],
  minSelection: 0,
  dependencies: []
})
