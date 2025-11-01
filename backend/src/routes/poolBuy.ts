import type { Router, Request, Response } from 'express'
import { ENV } from '../lib/env.js'
import { getPool } from '../lib/pools.js'
import { reqNonNegativeInt, assert } from '../lib/validate.js'
import { estimateFeeSats } from '../lib/fees.js'
import { wocAddressUtxos, wocBroadcastTx } from '../adapters/woc.js'
import { bsv } from 'scrypt-ts'

const BASE58 = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/

export default function registerPoolBuy(app: Router) {
  app.post('/api/pool/:id/buy', async (req: Request, res: Response) => {
    try {
      // gate: testnet or explicitly allowed; prod will use user wallets (not DEV_WIF)
      const devBuyAllowed = ENV.ALLOW_DEV_BUY || ENV.NETWORK !== 'mainnet'
      assert(devBuyAllowed, 'pool buy disabled on mainnet in dev mode')

      const DEV_WIF = String(process.env.DEV_WIF || '').trim()
      assert(DEV_WIF, 'DEV_WIF not set')

      const pool = getPool(req.params.id)
      assert(pool, 'pool not found')

      // sanity on pool address (P2PKH testnet)
      const POOL_ADDR = String(pool.poolAddress || '').trim()
      assert(POOL_ADDR, 'pool has no address')
      if (/^[23]/.test(POOL_ADDR)) throw new Error('pool address is P2SH (invalid on BSV)')
      if (!BASE58.test(POOL_ADDR) || !/^[mn]/.test(POOL_ADDR))
        throw new Error(`pool address must be testnet P2PKH (m/n), got: ${POOL_ADDR}`)

      const body = req.body ?? {}
      const spendSats = reqNonNegativeInt(body.spendSats, 'spendSats')
      assert(spendSats > 0, 'spendSats must be > 0')

      // signer = DEV_WIF (for Day 12 test UX). Later: replace with user-signed flow.
      const net = ENV.NETWORK === 'mainnet' ? bsv.Networks.mainnet : bsv.Networks.testnet
      const key = bsv.PrivateKey.fromWIF(DEV_WIF)
      const fromAddress = key.toAddress(net).toString()

      const utxosRaw = await wocAddressUtxos(fromAddress)
      assert(Array.isArray(utxosRaw) && utxosRaw.length > 0, `no utxos for ${fromAddress}; fund DEV_WIF on testnet`)

      // coin selection
      const feeFloor = Math.max(estimateFeeSats(300), 200)
      const target = spendSats + feeFloor
      const sorted = [...utxosRaw].sort((a, b) => a.value - b.value)
      const chosen: typeof utxosRaw = []
      let sum = 0
      for (const u of sorted) { chosen.push(u); sum += u.value; if (sum >= target) break }
      assert(sum >= target, `insufficient funds: need ~${target}, have ${sum}`)

      const pkhScript = bsv.Script.buildPublicKeyHashOut(fromAddress).toHex()
      const inputs = chosen.map(u => ({
        txId: u.tx_hash,
        outputIndex: u.tx_pos,
        script: pkhScript,
        satoshis: u.value
      }))

      const tx = new bsv.Transaction()
      tx.from(inputs as any)
      tx.to(POOL_ADDR, spendSats)        // -> pay into THIS pool
      tx.change(fromAddress)
      tx.fee(Math.max(estimateFeeSats(tx.toBuffer().length || 300), feeFloor))
      tx.sign(key)
      assert(tx.isFullySigned(), 'tx not fully signed')

      const rawhex = tx.serialize({ disableDustOutputs: false })
      const txid = await wocBroadcastTx(rawhex)

      res.json({
        ok: true,
        network: ENV.NETWORK,
        poolId: pool.id,
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
