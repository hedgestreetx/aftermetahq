import React from 'react'

type State = { hasError: boolean; error?: any }

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false }
  static getDerivedStateFromError(error: any) { return { hasError: true, error } }
  componentDidCatch(err: any, info: any) { console.error('ErrorBoundary:', err, info) }
  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ padding: 16, fontFamily: 'Inter, system-ui' }}>
        <h2 style={{ color: '#b91c1c' }}>UI crashed</h2>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</pre>
      </div>
    )
  }
}
