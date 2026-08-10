import { useEffect, useId, useState, type JSX } from 'react'

const PANGRAM = 'The quick brown fox jumps over the lazy dog'
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const alpha = 'abcdefghijklmnopqrstuvwxyz'
const NUMS = '0123456789'

type Props = {
  url: string
}

export function FontPreview({ url }: Props): JSX.Element {
  const reactId = useId().replace(/:/g, '')
  const family = `MfePreviewFont_${reactId}`
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    const face = new FontFace(family, `url(${JSON.stringify(url)})`)
    void face
      .load()
      .then((loaded) => {
        if (cancelled) return
        document.fonts.add(loaded)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
      try {
        document.fonts.delete(face)
      } catch {
        // FontFace may not be in the set yet
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
