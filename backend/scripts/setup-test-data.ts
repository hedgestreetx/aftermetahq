
import fetch from 'node-fetch';

const WIF = 'cNQtF1arRcJA9ayi6USNPGEuDcb9my81gasu44UKezxH1Qvm1jLo';
const POOL_ID = 'pool-test';
const API_BASE = process.env.VITE_API_URL ?? "http://localhost:3000";

async function makeMintRequest() {
  try {
    const response = await fetch(`${API_BASE}/v1/mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wif: WIF, spendSats: 1000, poolId: POOL_ID, symbol: 'TST' }),
    });
    const mintResponse = await response.json();
    if (response.ok) {
      console.log(`[TEST] Created real minting transaction with txid: ${mintResponse.txid}`);
    } else {
      console.error(`[TEST] Failed to create minting transaction: ${mintResponse.error}`);
    }
  } catch (error) {
    if (error instanceof Error) {
        console.error(`[TEST] Failed to create minting transaction: ${error.message}`);
    } else {
        console.error(`[TEST] Failed to create minting transaction: ${error}`);
    }
  }
}

makeMintRequest();
