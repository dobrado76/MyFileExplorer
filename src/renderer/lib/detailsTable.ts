/** Matches `.details-header` / `.row` padding (10+10) and 8px flex gap. */
export function detailsTableMinWidth(nameWidth: number, columnWidths: number[]): number {
  const gaps = 8 * columnWidths.length
  return 20 + nameWidth + columnWidths.reduce((sum, w) => sum + w, 0) + gaps
}
