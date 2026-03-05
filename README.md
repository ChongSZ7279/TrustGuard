## TrustGuard – Real-Time Fraud & Anomaly Detection (SDG 8.10)

TrustGuard is a lightweight, end-to-end prototype of a **real-time AI fraud detection system** for **digital wallets serving unbanked users in ASEAN**. It supports **SDG 8.10** by strengthening trust in digital payments while minimising friction for legitimate users.

### 1. Architecture

- **User Wallet / Super App** → sends transaction request
- **FastAPI Fraud Service** (`/check-transaction`)
- **Behavioral Profiling Layer** – per-user baseline (amount, time, device, geolocation, merchants)
- **ML Fraud Model** – XGBoost classifier trained with SMOTE + class weighting (optional but integrated)
- **Risk Scoring Engine** – combines rules + ML probability into a unified **0–1 risk score**
- **Decision Engine** – thresholds: **APPROVE / FLAG / BLOCK**
- **Monitoring Dashboard** – React + Tailwind + Chart.js
- **Optional Blockchain Fraud Registry** – Solidity contract for tamper-proof fraud records

### 2. Tech Stack

- **Backend / API**: Python, FastAPI, Uvicorn
- **ML**: scikit-learn, imbalanced-learn (SMOTE), XGBoost, PyOD-ready structure
- **Frontend**: React (Vite), TailwindCSS, Chart.js (`react-chartjs-2`)
- **Data**: any CSV fraud dataset (e.g. Kaggle: IEEE-CIS, Credit Card Fraud, PaySim, SAML-D)
- **Database**: profiles and logs are in-memory for simplicity (can be swapped to MongoDB)
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

uvicorn app.main:app --reload --port 8000
```

The API will be available at `http://localhost:8000` and docs at `http://localhost:8000/docs`.

#### 3.2 Core endpoint – `/check-transaction`

- **Method**: `POST /check-transaction`
- **Latency goal**: real-time, milliseconds on a single CPU core.

Example request:

```json
{
  "user_id": "U1001",
  "amount": 2500,
  "location": "Thailand",
  "device_id": "device_234",
  "time": "03:20",
  "merchant_id": "M998",
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
  "timestamp": "2026-03-05T03:20:31.123456+00:00"
}
```

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

Usage (example with a Kaggle CSV):

```bash
cd backend
.venv\Scripts\activate

python -m ml.train_model --data path\to\your_dataset.csv --label-column is_fraud --output-dir backend/models
```

The script will:

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

The dashboard runs at `http://localhost:5173` and proxies API calls to `http://localhost:8000` under `/api/*`.

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

- `/stats/overview`
- `/stats/recent?limit=50`
- `/stats/risk-distribution`

---

### 6. Privacy-First Data Handling

This prototype demonstrates privacy-conscious design:

- **Anonymised IDs**: only `user_id`, `device_id`, and `merchant_id` codes are used—no names or emails.
- **Minimal data**: scores and metadata needed for fraud decisions; no unnecessary PII.
- **In-memory profiles**: for demo, user behavior is held in memory; in production this would be encrypted at rest in a secure database (e.g. MongoDB with encryption).
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
- set the `--label-column` name to the fraud label (e.g. `Class`, `isFraud`, `is_fraud`)
- optionally engineer additional contextual features for better accuracy

All tooling (Python, Node, local chain / testnets, datasets) is available **for free**, making the solution suitable for hackathons, student projects, or early-stage pilots in ASEAN fintech ecosystems.

