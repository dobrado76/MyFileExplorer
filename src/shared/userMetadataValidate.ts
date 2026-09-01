/**
 * Whole-value text validation for D70 user metadata.
 * Pattern length / input length bounds reduce risk; callers MUST also use a
 * timeout-protected evaluator so catastrophic backtracking cannot block Electron.
 */

import {
  MAX_TEXT_VALUE_LEN,
  MAX_VALIDATION_PATTERN_LEN,
  type UserMetadataField,
  type UserMetadataTextValidation
} from './schemas/userMetadata'

export type SafeRegexCompileResult =
  | { ok: true; source: string; flags: '' | 'i' }
  | { ok: false; message: string }

/** Reject flags other than '' | 'i', overlong patterns, and obvious nested-quantifier bombs. */
export function compileWholeValuePattern(
  validation: UserMetadataTextValidation
): SafeRegexCompileResult {
  const pattern = validation.pattern
  if (!pattern || pattern.length > MAX_VALIDATION_PATTERN_LEN) {
    return { ok: false, message: `Pattern must be 1–${MAX_VALIDATION_PATTERN_LEN} characters` }
  }
  const flags = validation.flags === 'i' ? 'i' : ''
  // Nested +/* on the same group is a classic ReDoS shape, e.g. (a+)+$
  if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern) || /(\+\+|\*\*|\+\*|\*\+)/.test(pattern)) {
    return {
      ok: false,
      message: 'Pattern looks unsafe (nested quantifiers). Simplify it or use Scripts for transforms.'
    }
  }
  try {
    new RegExp(`^(?:${pattern})$`, flags)
  } catch {
    return { ok: false, message: 'Invalid regular expression' }
  }
  return { ok: true, source: pattern, flags }
}

export type TextValidateResult = { ok: true } | { ok: false; message: string }

/**
 * Synchronous whole-value test. Prefer `testWholeValueProtected` in main (timeout worker).
 * Empty string is always OK (optional field).
 */
export function testWholeValueSync(
  value: string,
  validation: UserMetadataTextValidation | undefined,
  limits?: { minLength?: number; maxLength?: number }
): TextValidateResult {
  if (!value) return { ok: true }
  if (value.length > MAX_TEXT_VALUE_LEN) {
    return { ok: false, message: `Text cannot exceed ${MAX_TEXT_VALUE_LEN} characters` }
  }
  if (limits?.maxLength != null && value.length > limits.maxLength) {
    return { ok: false, message: `Must be at most ${limits.maxLength} characters` }
  }
  if (limits?.minLength != null && value.length < limits.minLength) {
    return { ok: false, message: `Must be at least ${limits.minLength} characters` }
  }
  if (!validation) return { ok: true }
  const compiled = compileWholeValuePattern(validation)
  if (!compiled.ok) return compiled
  try {
    const re = new RegExp(`^(?:${compiled.source})$`, compiled.flags)
    if (!re.test(value)) {
      return {
        ok: false,
        message: validation.message?.trim() || 'Value does not match the required pattern'
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Invalid regular expression' }
  }
}

export function validateTextFieldValue(
  field: UserMetadataField,
  value: string
): TextValidateResult {
  if (field.type !== 'text') return { ok: true }
  return testWholeValueSync(value, field.text?.validation, {
    minLength: field.text?.minLength,
    maxLength: field.text?.maxLength
  })
}
