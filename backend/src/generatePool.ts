// backend/generatePool.ts
import { bsv } from 'scrypt-ts'

async function main() {
  const privateKey = bsv.PrivateKey.fromRandom('testnet')
  const publicKey = bsv.PublicKey.fromPrivateKey(privateKey)
  const address = bsv.Address.fromPublicKey(publicKey, 'testnet')
  const lockingScript = bsv.Script.buildPublicKeyHashOut(address)

  console.log('==============================')
  console.log('Network: testnet')
  console.log('Private Key (WIF):', privateKey.toWIF())
  console.log('Address:', address.toString())
  console.log('Locking Script Hex:', lockingScript.toHex())
  console.log('==============================')
}

main().catch(console.error)
