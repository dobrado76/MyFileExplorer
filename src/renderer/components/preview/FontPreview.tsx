import { useEffect, useId, useState, type JSX } from 'react'

const PANGRAM = 'The quick brown fox jumps over the lazy dog'
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const alpha = 'abcdefghijklmnopqrstuvwxyz'
const NUMS = '0123456789'

type Props = {
  url: string
}

async function loadFontFace(family: string, url: string): Promise<FontFace> {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`font fetch ${res.status}`)
    const buf = await res.arrayBuffer()
    const face = new FontFace(family, buf)
    return await face.load()
  } catch {
    const face = new FontFace(family, `url(${JSON.stringify(url)}) format("truetype")`)
    return await face.load()
  }
}

export function FontPreview({ url }: Props): JSX.Element {
  const reactId = useId().replace(/:/g, '')
  const family = `MfePreviewFont_${reactId}`
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    let added: FontFace | null = null
    setStatus('loading')
    void loadFontFace(family, url)
      .then((loaded) => {
        if (cancelled) return
        document.fonts.add(loaded)
        added = loaded
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
      if (added) {
        try {
          document.fonts.delete(added)
        } catch {
          /* already gone */
        }
      }
    }
  }, [url, family])

  if (status === 'error') {
    return (
      <div className="preview-font preview-font-error">
        Could not load font for preview. Use Open with default app.
      </div>
    )
  }

  if (status === 'loading') {
    return <div className="preview-font preview-font-loading">Loading font…</div>
  }

  const style = { fontFamily: `"${family}", sans-serif` } as const

  return (
    <div className="preview-font" style={style}>
      <div className="preview-font-sample preview-font-lg">{PANGRAM}</div>
      <div className="preview-font-sample preview-font-md">{PANGRAM}</div>
      <div className="preview-font-sample preview-font-sm">{PANGRAM}</div>
      <div className="preview-font-meta mono">
        <div>{ALPHA}</div>
        <div>{alpha}</div>
        <div>{NUMS}</div>
      </div>
    </div>
  )
}
