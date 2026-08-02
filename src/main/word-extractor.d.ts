declare module 'word-extractor' {
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<{
      getBody(): string
      getHeaders(): { headers: string; footers: string }
      getAnnotations(): string
      getTextboxes(): { headers: string; body: string; footers: string }
    }>
  }
}
