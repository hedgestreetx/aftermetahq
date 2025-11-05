# Aftermeta

This is a **clean, minimal baseline** for the Aftermeta app to get you unstuck.

## What you get
- **backend/** Express + TypeScript server with endpoints:
  - `GET /health`
  - `GET /admin/state`
  - `GET /admin/pool/balance` (dummy based on ENV; swap in your real logic)
  - `GET /api/utxos/:address` (WhatsOnChain testnet)
  - `POST /api/dev/buy` (guarded by env, *no* bonding-curve logic — stub hook provided)
  - `POST /api/broadcast` (WhatsOnChain broadcast)
  - `GET /api/tx/:txid` (WhatsOnChain tx lookup)
- **frontend/** Vite + React + TS with an Admin panel and status readout.
- Cohesive .env wiring that actually loads from the **backend root**.

## Quickstart

### 1) Backend
```bash
cd backend
cp .env.example .env
# edit .env
npm install
npm run dev
# server at http://localhost:3000
```

### 2) Frontend
```bash
cd frontend
npm install
# choose one approach:

# (A) Use VITE_API_URL (recommended)
echo "VITE_API_URL=http://localhost:3000" > .env
npm run dev  # http://localhost:5173

# (B) Use proxy (uncomment in vite.config.ts)
npm run dev
```
