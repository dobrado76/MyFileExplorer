import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/** Keeps a render crash from replacing the whole window with a blank native frame. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('renderer crashed', error, info.componentStack)
  }

  override render(): JSX.Element {
    if (!this.state.error) return <>{this.props.children}</>
    const message = this.state.error.message || String(this.state.error)
    const stack = this.state.error.stack ?? ''
    return (
      <div
        className="shell"
        style={{
          padding: 24,
          overflow: 'auto',
          color: 'var(--text)',
          background: 'var(--bg)'
        }}
      >
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Something broke the window</h1>
        <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>{message}</p>
        {stack ? (
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontSize: 12,
              color: 'var(--text-dim)',
              maxWidth: 900
            }}
          >
            {stack}
          </pre>
        ) : null}
        <button type="button" className="btn" style={{ marginTop: 16 }} onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
