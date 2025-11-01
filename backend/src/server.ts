// backend/src/server.ts
import express from 'express'
import morgan from 'morgan'
import cors from 'cors'

import { ENV } from './lib/env'      // no .js in TS source

import registerAdmin from './routes/admin'
import registerUtxos from './routes/utxos'
import registerDevBuy from './routes/devBuy'
import registerBroadcast from './routes/broadcast'
import registerTx from './routes/tx'
import registerPoolCreate from './routes/poolCreate'
import registerPoolList from './routes/poolList'
import registerPoolBuy from './routes/poolBuy.js'
import registerPoolState from './routes/poolState.js'
// If you want thrown async errors to hit the error handler:


const app = express()

app.use(cors(/* you can restrict with { origin: ENV.FRONTEND_ORIGIN } */))
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

// health
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'aftermeta-backend',
    env: { network: ENV.NETWORK, port: ENV.PORT }
  })
})

// routes (each route module must mount under /api/... internally)
registerAdmin(app)
registerUtxos(app)
registerDevBuy(app)
registerBroadcast(app)
registerTx(app)
registerPoolCreate(app)
registerPoolList(app)
registerPoolBuy(app)
registerPoolState(app)

// central error handler (will work with express-async-errors)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[UNHANDLED]', err)
  res.status(500).json({
    ok: false,
    error: 'internal_error',
    detail: String((err && (err.message || err)) || 'unknown')
  })
})

app.listen(ENV.PORT, () => {
  console.log(`[BACKEND] up on http://localhost:${ENV.PORT} network=${ENV.NETWORK}`)
})
