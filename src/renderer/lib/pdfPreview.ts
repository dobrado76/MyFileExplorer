/**
 * Chromium PDF open params: hide thumbnails/outline sidenav and start at 100%
 * zoom so the pane is readable without hunting toolbar controls.
 * @see chromium open_pdf_params_parser.ts
 */
export function pdfPreviewSrc(url: string): string {
  const hash = 'navpanes=0&zoom=100'
  const base = url.split('#')[0] ?? url
  return `${base}#${hash}`
}
