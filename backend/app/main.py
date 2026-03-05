from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Literal, List, Dict, Any
from datetime import datetime, timezone
from collections import deque

from .risk_engine import RiskEngine, RiskDecision
from .blockchain_registry import BlockchainRegistryClient, FraudRecord


class TransactionRequest(BaseModel):
    user_id: str = Field(..., description="Anonymized user identifier")
    amount: float
    location: str
    device_id: str
    time: str = Field(..., description="HH:MM in 24h format (local user time)")
    merchant_id: str
    ip_reputation: Optional[float] = Field(
        None, ge=0.0, le=1.0, description="0 (bad) → 1 (good)"
    )


class TransactionResponse(BaseModel):
    risk_score: float = Field(..., ge=0.0, le=1.0)
    decision: Literal["APPROVE", "FLAG", "BLOCK"]
    reason: str
    latency_ms: float
    timestamp: datetime


class TransactionLogEntry(BaseModel):
    id: int
    user_id: str
    amount: float
    location: str
    device_id: str
    merchant_id: str
    decision: Literal["APPROVE", "FLAG", "BLOCK"]
    risk_score: float
    timestamp: datetime


app = FastAPI(
    title="TrustGuard Fraud Detection API",
    description="Real-time fraud & anomaly detection for digital wallets",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

risk_engine = RiskEngine()
blockchain_client = BlockchainRegistryClient(enabled=False)
_tx_log: deque[TransactionLogEntry] = deque(maxlen=5000)
_tx_counter = 0


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/check-transaction", response_model=TransactionResponse)
def check_transaction(tx: TransactionRequest):
    global _tx_counter
    start = datetime.utcnow().replace(tzinfo=timezone.utc)

    result = risk_engine.score_transaction(
        user_id=tx.user_id,
        amount=tx.amount,
        location=tx.location,
        device_id=tx.device_id,
        time_str=tx.time,
        merchant_id=tx.merchant_id,
        ip_reputation=tx.ip_reputation,
    )

    now = datetime.utcnow().replace(tzinfo=timezone.utc)
    latency = (now - start).total_seconds() * 1000.0

    _tx_counter += 1
    log_entry = TransactionLogEntry(
        id=_tx_counter,
        user_id=tx.user_id,
        amount=tx.amount,
        location=tx.location,
        device_id=tx.device_id,
        merchant_id=tx.merchant_id,
        decision=result.decision,
        risk_score=result.risk_score,
        timestamp=now,
    )
    _tx_log.appendleft(log_entry)

    return TransactionResponse(
        risk_score=result.risk_score,
        decision=result.decision,
        reason=result.reason,
        latency_ms=latency,
        timestamp=now,
    )


@app.get("/baseline/{user_id}")
def get_user_baseline(user_id: str):
    profile = risk_engine.get_user_profile(user_id)
    if not profile:
        return {"user_id": user_id, "exists": False}
    return {"user_id": user_id, "exists": True, "profile": profile}


@app.get("/stats/overview")
def stats_overview() -> Dict[str, Any]:
    total = len(_tx_log)
    fraud = sum(1 for t in _tx_log if t.decision == "BLOCK")
    flagged = sum(1 for t in _tx_log if t.decision == "FLAG")
    approved = sum(1 for t in _tx_log if t.decision == "APPROVE")

    fraud_rate = (fraud / total) if total > 0 else 0.0

    return {
        "total_transactions": total,
        "blocked": fraud,
        "flagged": flagged,
        "approved": approved,
        "fraud_rate": round(fraud_rate, 4),
    }


@app.get("/stats/recent")
def stats_recent(limit: int = 50) -> List[TransactionLogEntry]:
    return list(list(_tx_log)[: max(0, min(limit, len(_tx_log)))])


@app.get("/stats/risk-distribution")
def stats_risk_distribution(buckets: int = 10):
    counts = [0] * buckets
    for t in _tx_log:
        idx = min(buckets - 1, int(t.risk_score * buckets))
        counts[idx] += 1
    return {"buckets": buckets, "counts": counts}


@app.post("/fraud/report-on-chain")
def report_fraud_on_chain(tx_id: int):
    if not blockchain_client.is_enabled():
        return {"enabled": False, "message": "Blockchain registry disabled in this demo backend."}

    target = next((t for t in _tx_log if t.id == tx_id and t.decision == "BLOCK"), None)
    if not target:
        return {"enabled": True, "success": False, "message": "Blocked transaction not found."}

    record = FraudRecord(
        transaction_hash=blockchain_client.compute_tx_hash(
            user_id=target.user_id,
            amount=target.amount,
            device_id=target.device_id,
            timestamp_iso=target.timestamp.isoformat(),
        ),
        risk_score=target.risk_score,
    )
    onchain_hash = blockchain_client.report_fraud(record)

    return {
        "enabled": True,
        "success": onchain_hash is not None,
        "transaction_hash": onchain_hash,
    }
