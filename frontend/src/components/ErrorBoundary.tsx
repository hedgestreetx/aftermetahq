import { Component, type ReactNode } from 'react'


type Props = { children: ReactNode }
type State = { hasError: boolean; msg?: string }


export default class ErrorBoundary extends Component<Props, State> {
state: State = { hasError: false }
static getDerivedStateFromError(e: any) { return { hasError: true, msg: String(e?.message || e) } }
componentDidCatch(e: any, info: any) { console.error('UI crash:', e, info) }
render() {
if (this.state.hasError) {
return (
<div style={{ padding: 24, fontFamily: 'system-ui' }}>
<h2>UI crashed</h2>
<pre>{this.state.msg}</pre>
</div>
)
}
return this.props.children
}
}