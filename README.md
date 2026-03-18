## TrustGuard – Real-Time Fraud & Anomaly Detection (SDG 8.10)

TrustGuard is a lightweight, end-to-end prototype of a **real-time AI fraud detection system** for **digital wallets serving unbanked users in ASEAN**. It supports **SDG 8.10** by strengthening trust in digital payments while minimising friction for legitimate users.

### 1. Architecture

- **User Wallet / Super App** → sends transaction request
- **FastAPI Fraud Service** (`/transactions` preferred, `/check-transaction` kept for compatibility)
- **Behavioral Profiling Layer** – per-user baseline (amount, time, device, geolocation, merchants)
- **ML Fraud Model** – XGBoost classifier trained with SMOTE + class weighting (optional but integrated)
- **Risk Scoring Engine** – combines rules + ML probability into a unified **0–1 risk score**
- **Decision Engine** – thresholds: **APPROVE / FLAG / BLOCK**
- **Monitoring Dashboard** – React + Tailwind + Chart.js
- **MongoDB Transaction Store** – persists current & today’s history
- **Tamper-evident Ledger (“Mini Blockchain”)** – MongoDB ledger chain (hash-linked) per transaction
- **Optional Blockchain Fraud Registry** – Solidity contract for tamper-proof fraud records (manual/demo stub)

### 2. Tech Stack

- **Backend / API**: Python, FastAPI, Uvicorn
- **ML**: scikit-learn, imbalanced-learn (SMOTE), XGBoost, PyOD-ready structure
- **Frontend**: React (Vite), TailwindCSS, Chart.js (`react-chartjs-2`)
- **Data**: any CSV fraud dataset (e.g. Kaggle: IEEE-CIS, Credit Card Fraud, PaySim, SAML-D)
- **Database**: profiles and logs are in-memory for simplicity (can be swapped to MongoDB)
- **Database (Demo)**: MongoDB is used to persist transactions, police blocklist, and ledger chain
- **Blockchain (optional)**: Solidity contract `FraudRegistry.sol` deployable to an Ethereum testnet

All components run **locally** using free tools (Python + Node.js + free public datasets).

---

### 3. Backend – FastAPI Fraud Detection Service

Backend root: `backend/`

- App entrypoint: `backend/app/main.py`
- Behavior & risk logic: `backend/app/risk_engine.py`
- Optional ML model loader: `backend/app/ml_inference.py`
- Blockchain stub: `backend/app/blockchain_registry.py`
- Training script: `backend/ml/train_model.py`
- Python deps: `backend/requirements.txt`

#### 3.1 Install & run backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate  # Windows PowerShell
pip install -r requirements.txt

set MONGODB_URI=mongodb://localhost:27017
set MONGODB_DB=trustguard
set POLICE_BEARER_TOKEN=police-demo-token
set POLICE_API_KEY=police-demo-key
set USE_MONGO_BASELINES=1

uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000` and docs at `http://localhost:8000/docs`.

#### 3.2 Core endpoint – `/transactions` (persisted)

- **Method**: `POST /check-transaction`
- **Latency goal**: real-time, milliseconds on a single CPU core.

Example request:

```json
{
  "user_id": "U1001",
  "amount": 2500,
  "location": "Thailand",
  "device_id": "device_234",
  "device_fingerprint": "fp_demo_001",
  "time": "03:20",
  "merchant_id": "M998",
  "ip_address": "203.0.113.13",
  "ip_reputation": 0.8
}
```

Example response (from `TransactionResponse`):

```json
{
  "risk_score": 0.91,
  "decision": "BLOCK",
  "reason": "High amount combined with risky IP; New device and different country/location detected; ML fraud probability=0.903",
  "latency_ms": 3.21,
  "timestamp": "2026-03-05T03:20:31.123456+00:00",
  "tx_id": "65f1f8c2d3e1...",
  "ledger_hash": "0x...",
  "model_loaded": true
}
```

#### 3.2.1 Wallet-facing endpoint – `/risk/score` (no persistence)

For a real **real-time checkout** flow (super-app / wallet), call:

- `POST /risk/score` → returns an instant decision (**no DB write**)
- if decision is not `BLOCK`, optionally call `POST /transactions` to persist for audit + dashboard

This reduces user-facing latency and avoids writing blocked attempts unless you want an audit trail.

Recommended endpoint for the UI:

- `POST /transactions` → scores + **stores in MongoDB** + returns `tx_id` + `ledger_hash`
- `GET /transactions/today?user_id=...` → user history **today only**

**Decision rules** (after combining rules + ML):

- `0.00 – 0.30` → **APPROVE**
- `0.30 – 0.70` → **FLAG**
- `0.70 – 1.00` → **BLOCK**

Every decision is accompanied by an **explainable `reason` string** listing the drivers (high amount vs baseline, new device, unusual time, ML probability, etc.).

#### 3.3 Behavioral profiling

Implemented in `backend/app/risk_engine.py` via `UserBehaviorProfile`:

- **Per-user baseline features**:
  - average transaction amount
  - transaction count and variance (σ, z-score)
  - hour-of-day histogram
  - most common location
  - most common device
  - most frequent merchants
- Updated after every transaction to adapt over time.

Behavioral rules increase risk when:

- amount is **>5x** normal baseline (or >10x with sparse history)
- amount is **>3σ** above mean
- new / rare device is used
- location differs from the usual one
- transaction time is unusual vs histogram (e.g. 3 AM but user usually pays 8am–7pm)
- merchant is outside usual categories
- **contextual signals** like low `ip_reputation` or a **new device + new country** combination

The engine exposes a `/baseline/{user_id}` endpoint to inspect a user’s current profile.

#### 3.4 Contextual data integration

Extra signals are integrated into the risk score:

- `ip_reputation` (0 = very bad, 1 = very good)
- new device detection vs historical devices
- new geographic location vs historical locations
- time-of-day vs typical activity window

You can extend this pattern to add:

- VPN / TOR detection
- geo-distance from last transaction
- device fingerprint confidence

---

### 4. Machine Learning – Imbalanced Fraud Detection

Directory: `backend/ml/`

#### 4.1 Training script

`train_model.py` implements an XGBoost-based fraud classifier with:

- **SMOTE** oversampling of minority (fraud) class
- **class weighting** (`scale_pos_weight`) based on fraud ratio
- **standard scaling** of numerical features

Enable SMOTE (recommended for extreme imbalance):

```bash
python backend/ml/train_model.py --data-dir backend/ml/data --smote --smote-ratio 0.2 --smote-k 5
```

#### 4.1.1 Train from Kaggle / arbitrary CSV (column mapping)

Many datasets (e.g. Kaggle Credit Card Fraud) have different schemas. Use:

- `backend/ml/train_from_csv.py` → trains the **same real-time feature vector** used by the API:
  - `amount`, `hour`, `ip_reputation`, `amount_ratio`, `is_new_device`, `is_new_location`

Example (Kaggle Credit Card Fraud: columns `Time`, `Amount`, `Class`):

```bash
cd backend
.venv\Scripts\activate

python -m ml.train_from_csv ^
  --data path\to\creditcard.csv ^
  --amount-col Amount ^
  --time-col Time ^
  --label-col Class ^
  --smote --smote-ratio 0.2
```

Notes:

- `python -m ml.train_model` is the **IEEE-CIS** trainer (expects `train_transaction.csv` + `train_identity.csv`).
- `python -m ml.train_from_csv` is the **generic** trainer for Kaggle/custom CSV exports.

Both trainers will:

- load CSV, split into train/test
- apply **SMOTE** to handle extreme class imbalance
- train a tuned **XGBoost** classifier
- print a **classification report** (precision / recall / F1)
- save `fraud_xgb_model.joblib` (model + scaler + feature names)

#### 4.2 Real-time inference

`backend/app/ml_inference.py` loads the saved model (if present) and provides `predict_proba` for a small feature vector derived from an incoming transaction:

- amount
- hour-of-day
- `ip_reputation`
- `amount_ratio` vs baseline
- boolean flags for **new device** and **new location**

`RiskEngine` blends model probability with rule score:

- combined risk = `0.6 * ML_prob + 0.4 * rule_score`

If no model file is found, the engine **falls back to pure rules** so the API still works.

You can plug in **PyOD anomaly detectors** in parallel to model rare-account activity (e.g. Isolation Forest, COPOD) using the same feature dictionary.

#### 4.3 End-to-end case study mapping (training → API → wallet UX)

- **Behavioral profiling**: `backend/app/risk_engine.py` maintains a per-user baseline (amount, time-of-day, device, location, merchants).
- **Real-time anomaly scoring**: `POST /risk/score` returns **APPROVE / FLAG / BLOCK** with `latency_ms` (milliseconds) and a human-readable `reason`.
- **Imbalanced fraud handling**: training scripts support **SMOTE** and class weighting; output is `backend/models/fraud_xgb_model.joblib`.
- **Contextual signals**: the API accepts `ip_reputation` or `ip_address` (derived to a reputation score) and optional `device_fingerprint`.
- **Privacy-first**: only hashed contextual identifiers are stored (`ip_hash`, `device_fingerprint_hash`); dashboards default to **today-only** visibility.

---

### 5. Frontend – Fraud Monitoring Dashboard

Frontend root: `frontend/`

- Vite React app (TypeScript)
- TailwindCSS for styling
- Chart.js via `react-chartjs-2`

#### 5.1 Install & run dashboard

```bash
cd frontend
npm install  # or pnpm / yarn
npm run dev
```

The dashboard runs at `http://localhost:5173` and calls the backend at `VITE_API_BASE_URL` (default: `http://localhost:8000`).

#### 5.2 Dashboard sections

- **Overview Panel** (`OverviewPanel`):
  - total transactions
  - approved / flagged / blocked counts
  - fraud rate (%)
- **Live Transaction Monitor** (`LiveTransactionsTable`):
  - transaction ID
  - user ID (anonymised)
  - amount (RM)
  - location, device, merchant
  - risk score (0–1)
  - decision badge:
    - **Green** → APPROVED
    - **Yellow** → FLAGGED
    - **Red** → BLOCKED
  - timestamp (local time)
- **Risk Score Distribution Chart** (`RiskCharts`):
  - bar chart of counts across risk score buckets (0.0–1.0)

The app polls the backend every **2 seconds** for:

- `/stats/overview-today`
- `/stats/recent-today?limit=50`
- `/stats/risk-distribution-today`

### 6. Police / Investigator Flow (Demo)

The frontend includes a **Police / Investigator Console** (View 3).

Backend endpoints (prefer `Authorization: Bearer <token>` matching `POLICE_BEARER_TOKEN`; `X-Police-Key` is kept as a legacy/demo fallback):

- `GET /police/transactions/today` → all transactions **today only**
- `GET /police/blocked-users` → list blocked users
- `POST /police/block-user` → block a user by `user_id` + reason

Policy behavior:

- If a user is blocked, `/transactions` and `/check-transaction` will always return `decision="BLOCK"` for that user.

### 7. MongoDB + Ledger (“Mini Blockchain”)

MongoDB collections:

- `transactions`: every transaction attempt + risk decision
- `blocked_users`: police blocklist
- `ledger`: hash-linked ledger entries with `prev_hash` and `hash`

Ledger properties:

- Each transaction gets a `ledger_hash` that commits to the transaction fields + timestamp + `prev_hash`.
- This makes the log **tamper-evident** (any mutation breaks the chain), suitable for audit trails in a trust system.

---

### 6. Privacy-First Data Handling

This prototype demonstrates privacy-conscious design:

- **Anonymised IDs**: only `user_id`, `device_id`, and `merchant_id` codes are used—no names or emails.
- **Minimal data**: scores and metadata needed for fraud decisions; no unnecessary PII.
- **In-memory profiles**: for demo, user behavior is held in memory; in production this would be encrypted at rest in a secure database (e.g. MongoDB with encryption).
- **No raw IP persistence**: if `ip_address` is provided, the backend derives an `ip_reputation` score for risk and stores only `ip_hash` (deterministic hash) for telemetry/audit.
- **No raw device fingerprint persistence**: if `device_fingerprint` is provided, the backend stores only `device_fingerprint_hash`.
- **Secure transport**: in production, the same FastAPI app should be served **behind HTTPS** (reverse proxy like Nginx or a managed load balancer).
- **Explainability**: every decision includes explicit reasons, enabling human review and bias checks.

---

### 7. Optional Innovation – Blockchain Fraud Registry

Files:

- Solidity contract: `blockchain/FraudRegistry.sol`
- Backend stub: `backend/app/blockchain_registry.py`
- API hook: `POST /fraud/report-on-chain`

#### 7.1 Smart contract

`FraudRegistry.sol` exposes:

- `reportFraud(bytes32 transactionHash, uint256 riskScoreBps)`
- `getFraudReports()`

Each report stores:

- `txHash` (transaction hash)
- `riskScoreBps` (risk score in basis points, 0–10,000)
- `timestamp`

Deploy this contract to an **Ethereum testnet** (e.g. Sepolia) using free tools like:

- Remix IDE
- Hardhat + a free RPC provider

#### 7.2 Backend integration (optional)

`BlockchainRegistryClient` is an opt-in stub:

- Computes a deterministic **SHA-256 transaction hash** from:
  - user_id (anonymised)
  - amount
  - device_id
  - timestamp
- Can be wired to a real `web3.py` client to call `reportFraud`.
- Disabled by default to avoid key/RPC management in this demo.

API endpoint:

- `POST /fraud/report-on-chain?tx_id={id}`
- Looks up a **BLOCK** decision in the in-memory log
- Computes a transaction hash
- Returns the hash that can be submitted to the smart contract

This enables:

- **tamper-proof fraud intelligence**
- **cross-platform sharing of confirmed fraud cases**

---

### 8. Demo Scenario (Hackathon Flow)

1. **Start backend**: `uvicorn app.main:app --reload --port 8000`.
2. **Start frontend**: `npm run dev` in `frontend/`.
3. **Scenario A – Normal behavior (APPROVE)**  
   - Call `/check-transaction` multiple times for `user_id="U1001"` with small amounts (e.g. `RM20`), daytime hours, same location (e.g. `Johor`), known device & merchants.  
   - Dashboard shows mostly **green APPROVED** with low risk scores.
4. **Scenario B – Slight anomaly (FLAG)**  
   - Increase amount moderately, use a new merchant or slightly unusual time.  
   - Risk score moves into `0.3–0.7` band; decision is **FLAG**, highlighted in yellow.
5. **Scenario C – High-risk fraud attempt (BLOCK)**  
   - Large amount (e.g. `RM2000`), new device, overseas location, poor `ip_reputation`.  
   - Risk score moves above `0.7`; decision is **BLOCK**, highlighted in red, with clear reasons.
6. **Explainability**  
   - Show `reason` field from API / dashboard to explain **why** each transaction was suspicious.
7. **Optional on-chain registry**  
   - Pick a blocked transaction ID from the dashboard and call `/fraud/report-on-chain?tx_id=...`.  
   - Use the returned `transaction_hash` with the Solidity contract to create a tamper-proof record.

---

### 9. Free Resources & Datasets

You can train and test using public datasets (download manually from Kaggle or similar):

- IEEE-CIS Fraud Detection
- Credit Card Fraud Dataset (Kaggle)
- PaySim synthetic mobile money simulation
- SAML-D Anti-Money Laundering Dataset

Because schemas differ, you will typically:

- map dataset columns (amount, time, device/IP features) into a common feature set
- set `--label-col` to the fraud label column (e.g. `Class`, `isFraud`, `is_fraud`)
- optionally engineer additional contextual features for better accuracy

All tooling (Python, Node, local chain / testnets, datasets) is available **for free**, making the solution suitable for hackathons, student projects, or early-stage pilots in ASEAN fintech ecosystems.

