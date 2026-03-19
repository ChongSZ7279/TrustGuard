# TrustGuard Blockchain Toolkit

This folder contains helper scripts for the tamper-evident ledger ("mini blockchain") and the optional on-chain fraud registry.

## What’s stored now

When a transaction is persisted via `POST /transactions` (including `BLOCK` attempts), the backend stores proof fields in MongoDB:

- `transactions.ledger_hash`
- `transactions.ledger_index`
- `transactions.ledger_prev_hash`
- `transactions.registry_tx_hash` (deterministic hash suitable for `FraudRegistry.reportFraud`)

Additionally, the backend maintains a hash-linked chain in:

- `ledger` collection (`prev_hash` + `hash` + `tx_object_id`)

## Scripts

### 1) Verify the mini-ledger chain

Checks that `ledger[i].prev_hash` correctly links to `ledger[i-1].hash` and that key proof fields match the referenced transaction.

Run:

```bash
python backend/blockchain/verify_ledger_chain.py
```

### 2) Export registry proofs for blocked transactions

Exports blocked transactions that already contain `registry_tx_hash` into JSONL you can manually submit to the Solidity contract (e.g. via Remix).

Run:

```bash
python backend/blockchain/export_blocked_registry_hashes.py --out blocked_registry_reports.jsonl
```

Each JSONL line contains:

- `transactionHash` (bytes32)
- `riskScoreBps` (0–10000)
- `tx_id`, `user_id`, `amount`, `device_id`, `created_at` (for reference)

## Environment variables

The scripts read the same MongoDB env vars as the backend:

- `MONGODB_URI` (default `mongodb://localhost:27017`)
- `MONGODB_DB` (default `trustguard`)

