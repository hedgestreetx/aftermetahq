import express from 'express'
import cors from 'cors'
import { ENV } from '../lib/env'
import routesv1 from './routes.v1.ts'
import mintRouter from './mintTestnet.ts'


const app = express()

app.use(cors({ origin: ['http://localhost:5173'],       // add your frontend origin(s)
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','X-Request-Id'], // <-- allow it
  credentials: false}))
app.use(express.json())
app.use(routesv1)
app.use(mintRouter)


app.listen(ENV.PORT, () => {
  console.log(`✅ Backend running on http://localhost:${ENV.PORT}`)
})
