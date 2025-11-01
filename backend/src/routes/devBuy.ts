// backend/src/routes/devBuy.ts
import type { Router, Request, Response } from 'express'
import { ENV } from '../lib/env.js'
import { reqNonNegativeInt, assert } from '../lib/validate.js'
import { estimateFeeSats } from '../lib/fees.js'
import { metrics } from '../lib/state.js'
import { wocAddressUtxos, wocBroadcastTx } from '../adapters/woc.js'
import { bsv } from 'scrypt-ts'

// ultra-light sanitizer so Windows BOM/CR garbage doesn't ruin your day
function clean(s: string): string {
  return s.replace(/^\uFEFF/, '').replace(/[^\x20-\x7E]/g, '').trim()
}
const BASE58 = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/

export default function registerDevBuy(app: Router) {
  app.post('/api/dev/buy', async (req: Request, res: Response) => {
    try {
      // ---- gates
      const devBuyAllowed = ENV.ALLOW_DEV_BUY || ENV.NETWORK !== 'mainnet'
      assert(devBuyAllowed, 'dev buy disabled')

      const DEV_WIF = clean(String(process.env.DEV_WIF || ''))
      assert(DEV_WIF, 'DEV_WIF not set')

      let POOL_ADDR = clean(String(ENV.POOL_P2SH_ADDRESS || ''))
      assert(POOL_ADDR, 'POOL address not set')

      // Hard block P2SH (BSV rejects it)
      if (/^[23]/.test(POOL_ADDR)) {
        throw new Error(`POOL must be P2PKH on BSV. Use testnet m/n, not ${POOL_ADDR[0]}.`)
      }
      // Quick sanity: base58 + testnet P2PKH prefix
      if (!BASE58.test(POOL_ADDR) || !/^[mn]/.test(POOL_ADDR)) {
        throw new Error(`POOL must be testnet P2PKH (starts with m/n). Got: ${POOL_ADDR}`)
      }

      // ---- body
      const body = req.body ?? {}
      const spendSats = reqNonNegativeInt(body.spendSats, 'spendSats')
      assert(spendSats > 0, 'spendSats must be > 0')

      // ---- signer
      const net = ENV.NETWORK === 'mainnet' ? bsv.Networks.mainnet : bsv.Networks.testnet
      const key = bsv.PrivateKey.fromWIF(DEV_WIF)
      const fromAddress = key.toAddress(net).toString()

      // ---- fund inputs
      const utxosRaw = await wocAddressUtxos(fromAddress)
      assert(Array.isArray(utxosRaw) && utxosRaw.length > 0,
        `no utxos for DEV_WIF address (${fromAddress}); fund it on testnet`)

      // simple coin selection
      const feeFloor = Math.max(estimateFeeSats(300), 200)
      const target = spendSats + feeFloor
      const sorted = [...utxosRaw].sort((a, b) => a.value - b.value)

      const chosen: typeof utxosRaw = []
      let sum = 0
      for (const u of sorted) {
        chosen.push(u); sum += u.value
        if (sum >= target) break
      }
      assert(sum >= target, `insufficient funds: need ~${target} sats incl. fee, have ${sum}`)

      // map to bsv inputs (signer is P2PKH)
      const pkhScript = bsv.Script.buildPublicKeyHashOut(fromAddress).toHex()
      const inputs = chosen.map(u => ({
        txId: u.tx_hash,
        outputIndex: u.tx_pos,
        script: pkhScript,
        satoshis: u.value
      }))

      // ---- build tx WITHOUT parsing the dest address
      const tx = new bsv.Transaction()
      tx.from(inputs as any)
      tx.to(POOL_ADDR, spendSats)              // let bsv handle address → script
      tx.change(fromAddress)
      tx.fee(Math.max(estimateFeeSats(tx.toBuffer().length || 300), feeFloor))
      tx.sign(key)
      assert(tx.isFullySigned(), 'tx not fully signed')

      const rawhex = tx.serialize({ disableDustOutputs: false })
      const txid = await wocBroadcastTx(rawhex)

      metrics.devBuys += 1
      res.json({
        ok: true,
        network: ENV.NETWORK,
        fromAddress,
        poolAddress: POOL_ADDR,
        spendSats,
        feePaid: tx.getFee(),
        inputCount: tx.inputs.length,
        outputCount: tx.outputs.length,
        txid
      })
    } catch (err: any) {
      res.status(400).json({ ok: false, error: String(err?.message || err) })
    }
  })
}
