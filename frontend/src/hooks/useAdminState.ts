import { useEffect, useState } from 'react'
import { adminState, type AdminState as AdminStateType } from '@/lib/api'


export type AdminState = AdminStateType


export function useAdminState(intervalMs = 5000) {
const [data, setData] = useState<AdminState | null>(null)
const [error, setError] = useState<string | null>(null)


useEffect(() => {
let alive = true
async function tick() {
try {
const res = await adminState()
if (!alive) return
setData(res)
setError(null)
} catch (e: any) {
if (!alive) return
setError(String(e?.message || e))
}
}
tick()
const id = setInterval(tick, intervalMs)
return () => { alive = false; clearInterval(id) }
}, [intervalMs])


return { data, error }
}