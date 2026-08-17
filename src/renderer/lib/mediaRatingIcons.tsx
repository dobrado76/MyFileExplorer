import type { JSX } from 'react'
import type { MediaRatingBrand } from '@shared/mediaRatings'

type MarkProps = { size?: number; title: string }

function Mark({
  size = 16,
  width,
  title,
  viewBox,
  children
}: MarkProps & { width?: number; viewBox: string; children: JSX.Element }): JSX.Element {
  return (
    <svg
      width={width ?? size}
      height={size}
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
    >
      <title>{title}</title>
      {children}
    </svg>
  )
}

function ImdbMark({ size = 16, title }: MarkProps): JSX.Element {
  return (
    <Mark size={size} width={Math.round(size * 2.2)} title={title} viewBox="0 0 40 18">
      <>
        <rect width="40" height="18" rx="3" fill="#F5C518" />
        <text
          x="20"
          y="13"
          textAnchor="middle"
          fill="#111"
          fontSize="9"
          fontWeight="800"
          fontFamily="Arial Black, Arial, sans-serif"
        >
          IMDb
        </text>
      </>
    </Mark>
  )
}

function RtMark({ size, title }: MarkProps): JSX.Element {
  return (
    <Mark size={size} title={title} viewBox="0 0 24 24">
      <>
        <path
          d="M7.2 5.2c.7-1.6 2-2.6 3.4-2.4.4 1.3-.1 2.6-1.1 3.4-.9.7-2 .9-2.3-1z"
          fill="#2F8F3E"
        />
        <path
          d="M12.2 3.1c1.5-.4 2.9.4 3.8 1.8-.5 1.8-1.8 2.4-3.1 2.1-1.1-.3-1.8-1.5-.7-3.9z"
          fill="#3BA34C"
        />
        <circle cx="12" cy="14.2" r="7.4" fill="#FA320A" />
        <path
          d="M9.2 12.4c.7-.8 1.6-1.2 2.6-1.1 1.3.1 2.3.9 2.8 2.1"
          fill="none"
          stroke="#7A1406"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </>
    </Mark>
  )
}

function MetacriticMark({
  size,
  title,
  tone
}: MarkProps & { tone: 'green' | 'yellow' | 'red' }): JSX.Element {
  const fill = tone === 'green' ? '#66CC33' : tone === 'yellow' ? '#FFCC33' : '#FF0000'
  return (
    <Mark size={size} title={title} viewBox="0 0 24 24">
      <>
        <rect width="24" height="24" rx="4" fill={fill} />
        <text
          x="12"
          y="17"
          textAnchor="middle"
          fill="#111"
          fontSize="13"
          fontWeight="800"
          fontFamily="Arial Black, Arial, sans-serif"
        >
          M
        </text>
      </>
    </Mark>
  )
}

function TmdbMark({ size, title }: MarkProps): JSX.Element {
  return (
    <Mark size={size} title={title} viewBox="0 0 24 24">
      <>
        <rect width="24" height="24" rx="5" fill="#01B4E4" />
        <path
          d="M5 8.2h14M8.2 8.2v8.2M15.8 8.2v8.2M5 16.4h14"
          fill="none"
          stroke="#0B1C24"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path d="M10.4 11.2l4 2.2-4 2.2v-4.4z" fill="#0B1C24" />
      </>
    </Mark>
  )
}

function PlexMark({ size, title }: MarkProps): JSX.Element {
  return (
    <Mark size={size} title={title} viewBox="0 0 24 24">
      <>
        <rect width="24" height="24" rx="5" fill="#E5A00D" />
        <path d="M9 6.4l9 5.6-9 5.6V6.4z" fill="#1B1408" />
      </>
    </Mark>
  )
}

function PlexAudienceMark({ size, title }: MarkProps): JSX.Element {
  return (
    <Mark size={size} title={title} viewBox="0 0 24 24">
      <>
        <rect width="24" height="24" rx="5" fill="#E5A00D" />
        <circle cx="12" cy="9.2" r="3.1" fill="#1B1408" />
        <path d="M5.8 18.6c.6-3.2 3-4.8 6.2-4.8s5.6 1.6 6.2 4.8" fill="#1B1408" />
      </>
    </Mark>
  )
}

function OtherMark({ size, title }: MarkProps): JSX.Element {
  return (
    <Mark size={size} title={title} viewBox="0 0 24 24">
      <path
        d="M12 2.6l2.4 6.6h7l-5.6 4.2 2.1 6.6L12 16.2 6.1 20l2.1-6.6L2.6 9.2h7L12 2.6z"
        fill="#E8B64C"
      />
    </Mark>
  )
}

export function metacriticTone(value: number, max?: number): 'green' | 'yellow' | 'red' {
  const n = max && max > 0 ? (value / max) * 100 : value <= 10 ? value * 10 : value
  if (n >= 61) return 'green'
  if (n >= 40) return 'yellow'
  return 'red'
}

export function MediaRatingIcon({
  brand,
  title,
  size = 16,
  value,
  max
}: {
  brand: MediaRatingBrand
  title: string
  size?: number
  value?: number
  max?: number
}): JSX.Element {
  const props = { size, title }
  switch (brand) {
    case 'imdb':
      return <ImdbMark {...props} />
    case 'rt':
      return <RtMark {...props} />
    case 'metacritic':
      return <MetacriticMark {...props} tone={metacriticTone(value ?? 0, max)} />
    case 'tmdb':
      return <TmdbMark {...props} />
    case 'plex':
      return <PlexMark {...props} />
    case 'plex-audience':
      return <PlexAudienceMark {...props} />
    default:
      return <OtherMark {...props} />
  }
}
