/**
 * Expand Windows-style `%VARIABLE%` segments (Explorer address bar).
 * Unknown / empty variables are left unchanged.
 */
export function expandWindowsEnvVars(
  input: string,
  lookup: (name: string) => string | undefined
): string {
  return input.replace(/%([^%]+)%/g, (all, name: string) => {
    const v = lookup(name)
    if (v == null || v === '') return all
    return v
  })
}
