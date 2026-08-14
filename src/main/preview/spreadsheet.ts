import fsp from 'node:fs/promises'
import type { SpreadsheetSheet } from '@shared/schemas/preview'

const MAX_SHEETS = 32
const MAX_ROWS = 2000
const MAX_COLS = 80
const CELL_CAP = 200
/** Soft cap so huge workbooks don't blow main-process memory. */
const MAX_BYTES = 32 * 1024 * 1024

function cellStr(v: unknown): string {
  if (v == null) return ''
  const s = typeof v === 'string' ? v : String(v)
  return s.length > CELL_CAP ? s.slice(0, CELL_CAP) + '…' : s
}

export async function buildSpreadsheetSheets(
  file: string,
  warnings: string[]
): Promise<SpreadsheetSheet[]> {
  const XLSX = await import('xlsx')
  // Prefer Node fs + XLSX.read(buffer): SheetJS readFile() throws
  // "Cannot access file …" when its internal fs binding is unavailable
  // (common with Electron / bundlers).
  const st = await fsp.stat(file)
  if (st.size > MAX_BYTES) {
    throw new Error(`Spreadsheet too large to preview (${Math.round(st.size / (1024 * 1024))} MB)`)
  }
  const buf = await fsp.readFile(file)
  const wb = XLSX.read(buf, {
    type: 'buffer',
    sheetRows: MAX_ROWS + 1,
    cellDates: true,
    dense: false
  })
  const names = wb.SheetNames.slice(0, MAX_SHEETS)
  if (wb.SheetNames.length > MAX_SHEETS) {
    warnings.push(`Showing first ${MAX_SHEETS} of ${wb.SheetNames.length} sheets`)
  }
  const sheets: SpreadsheetSheet[] = []
  for (const name of names) {
    const sheet = wb.Sheets[name]
    if (!sheet) continue
    const aoa = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false
    }) as unknown[][]
    let truncated = false
    const rows = aoa.slice(0, MAX_ROWS).map((row) => {
      const arr = Array.isArray(row) ? row : []
      if (arr.length > MAX_COLS) truncated = true
      return arr.slice(0, MAX_COLS).map(cellStr)
    })
    if (aoa.length > MAX_ROWS) {
      warnings.push(`Sheet “${name}” truncated to ${MAX_ROWS} rows`)
    }
    if (truncated) warnings.push(`Sheet “${name}” truncated to ${MAX_COLS} columns`)
    sheets.push({ name, rows })
  }
  return sheets
}
