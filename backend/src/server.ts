import express from 'express'
import morgan from 'morgan'
import cors from 'cors'

import { ENV } from './lib/env.js'
import registerAdmin from './routes/admin.js'
import registerUtxos from './routes/utxos.js'
import registerDevBuy from './routes/devBuy.js'
import registerBroadcast from './routes/broadcast.js'
import registerTx from './routes/tx.js'
import registerDevBuy from './routes/devBuy.js'
import registerPoolCreate from './routes/poolCreate.js'
import registerPoolList from './routes/poolList.js'



const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

// health
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'aftermeta-backend', env: { network: ENV.NETWORK, port: ENV.PORT } })
})

// routes
registerAdmin(app)
registerUtxos(app)
registerDevBuy(app)
registerBroadcast(app)
registerTx(app)
registerDevBuy(app)

registerPoolCreate(app)
registerPoolList(app)

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[UNHANDLED]', err)
  res.status(500).json({ ok: false, error: 'internal_error', detail: String(err && err.message || err) })
})

app.listen(ENV.PORT, () => {
  console.log(`[BACKEND] up on http://localhost:${ENV.PORT} network=${ENV.NETWORK}`)
})
