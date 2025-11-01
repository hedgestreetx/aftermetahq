// backend/src/generateTestnetKey.ts
import { bsv } from 'scrypt-ts'

const privateKey = new bsv.PrivateKey(null, bsv.Networks.testnet)
const address = privateKey.toAddress().toString()
console.log('WIF:', privateKey.toWIF())
console.log('Address:', address)
