import React from 'react'

export default function CrashOverlay() {
  const [err, setErr] = React.useState<string>('')

  React.useEffect(() => {
    const onErr = (e: ErrorEvent) => setErr(String(e?.error || e?.message || 'Unknown render error'))
    const onRej = (e: PromiseRejectionEvent) => setErr(String(e?.reason || 'Unhandled promise rejection'))
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  if (!err) return null
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      color: '#fff', padding: 16, zIndex: 999999, overflow: 'auto'
    }}>
      <h3 style={{ margin: 0, marginBottom: 8 }}>Runtime error</h3>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{err}</pre>
    </div>
  )
}
