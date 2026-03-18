import os
from datetime import date, time

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Literal, List, Dict, Any
from datetime import datetime, timezone
from collections import deque

from .risk_engine import RiskEngine, RiskDecision
from .blockchain_registry import BlockchainRegistryClient, FraudRecord
from .db import create_client, ensure_indexes, get_db, utc_now
from .ledger import append_ledger_entry


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
    tx_id: Optional[str] = Field(None, description="MongoDB id (present when persisted)")
    ledger_hash: Optional[str] = Field(None, description="Tamper-evident ledger hash (present when persisted)")


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
    tx_id: Optional[str] = None


class PoliceBlockUserRequest(BaseModel):
    user_id: str
    reason: str = Field(..., min_length=3, max_length=500)


class BlockedUserEntry(BaseModel):
    user_id: str
    reason: str
    blocked_at: datetime
    blocked_by: str


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


@app.on_event("startup")
async def _startup():
    client = create_client()
    app.state.mongo_client = client
    app.state.db = get_db(client)
    await ensure_indexes(app.state.db)


@app.on_event("shutdown")
async def _shutdown():
    client = getattr(app.state, "mongo_client", None)
    if client is not None:
        client.close()


def _police_api_key() -> str:
    return os.getenv("POLICE_API_KEY", "police-demo-key")


def _require_police(x_police_key: Optional[str]) -> str:
    if not x_police_key or x_police_key != _police_api_key():
        raise HTTPException(status_code=401, detail="Unauthorized (police key required)")
    return "police"


def _utc_day_range(now: datetime):
    d = now.date()
    start = datetime.combine(d, time.min).replace(tzinfo=timezone.utc)
    end = datetime.combine(d, time.max).replace(tzinfo=timezone.utc)
    return start, end


async def _is_user_blocked(user_id: str) -> Optional[Dict[str, Any]]:
    db = app.state.db
    return await db.blocked_users.find_one({"user_id": user_id})


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/check-transaction", response_model=TransactionResponse)
async def check_transaction(tx: TransactionRequest):
    global _tx_counter
    start = datetime.utcnow().replace(tzinfo=timezone.utc)

    blocked = await _is_user_blocked(tx.user_id)
    if blocked is not None:
        now = utc_now()
        return TransactionResponse(
            risk_score=1.0,
            decision="BLOCK",
            reason=f"User is blocked by police: {blocked.get('reason', 'policy')}",
            latency_ms=(now - start).total_seconds() * 1000.0,
            timestamp=now,
        )

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


@app.post("/transactions", response_model=TransactionResponse)
async def create_transaction(tx: TransactionRequest):
    """
    Preferred endpoint for the demo UI:
    - scores transaction
    - stores it in MongoDB
    - appends a tamper-evident ledger entry ("blockchain")
    """
    global _tx_counter

    start = utc_now()

    blocked = await _is_user_blocked(tx.user_id)
    if blocked is not None:
        now = utc_now()
        # Still persist the attempted transaction for audit trail
        result_decision: RiskDecision = "BLOCK"
        result_risk = 1.0
        result_reason = f"User is blocked by police: {blocked.get('reason', 'policy')}"
    else:
        result = risk_engine.score_transaction(
            user_id=tx.user_id,
            amount=tx.amount,
            location=tx.location,
            device_id=tx.device_id,
            time_str=tx.time,
            merchant_id=tx.merchant_id,
            ip_reputation=tx.ip_reputation,
        )
        result_decision = result.decision
        result_risk = result.risk_score
        result_reason = result.reason

    now = utc_now()
    latency = (now - start).total_seconds() * 1000.0

    doc = {
        "user_id": tx.user_id,
        "amount": float(tx.amount),
        "location": tx.location,
        "device_id": tx.device_id,
        "merchant_id": tx.merchant_id,
        "time_str": tx.time,
        "ip_reputation": tx.ip_reputation,
        "decision": result_decision,
        "risk_score": float(result_risk),
        "reason": result_reason,
        "latency_ms": float(latency),
        "created_at": now,
    }

    db = app.state.db
    ins = await db.transactions.insert_one(doc)

    ledger_payload = {
        "user_id": tx.user_id,
        "amount": float(tx.amount),
        "location": tx.location,
        "device_id": tx.device_id,
        "merchant_id": tx.merchant_id,
        "decision": result_decision,
        "risk_score": float(result_risk),
    }
    _, _, ledger_hash = await append_ledger_entry(db, tx_object_id=ins.inserted_id, tx_payload=ledger_payload, created_at=now)
    # Store ledger hash back into transaction for easy retrieval
    await db.transactions.update_one({"_id": ins.inserted_id}, {"$set": {"ledger_hash": ledger_hash}})

    # keep in-memory log for existing dashboard widgets
    _tx_counter += 1
    _tx_log.appendleft(
        TransactionLogEntry(
            id=_tx_counter,
            user_id=tx.user_id,
            amount=tx.amount,
            location=tx.location,
            device_id=tx.device_id,
            merchant_id=tx.merchant_id,
            decision=result_decision,
            risk_score=result_risk,
            timestamp=now,
            tx_id=str(ins.inserted_id),
        )
    )

    return TransactionResponse(
        risk_score=float(result_risk),
        decision=result_decision,
        reason=result_reason,
        latency_ms=float(latency),
        timestamp=now,
        tx_id=str(ins.inserted_id),
        ledger_hash=ledger_hash,
    )


@app.get("/transactions/today")
async def list_my_transactions_today(user_id: str, limit: int = 50):
    now = utc_now()
    start, end = _utc_day_range(now)
    db = app.state.db
    cursor = (
        db.transactions.find({"user_id": user_id, "created_at": {"$gte": start, "$lte": end}})
        .sort("created_at", -1)
        .limit(max(1, min(limit, 200)))
    )
    out = []
    async for doc in cursor:
        doc["tx_id"] = str(doc.pop("_id"))
        out.append(doc)
    return out


@app.get("/police/transactions/today")
async def police_list_transactions_today(
    limit: int = 200,
    x_police_key: Optional[str] = Header(None),
):
    _require_police(x_police_key)
    now = utc_now()
    start, end = _utc_day_range(now)
    db = app.state.db
    cursor = db.transactions.find({"created_at": {"$gte": start, "$lte": end}}).sort("created_at", -1).limit(
        max(1, min(limit, 500))
    )
    out = []
    async for doc in cursor:
        doc["tx_id"] = str(doc.pop("_id"))
        out.append(doc)
    return out


@app.post("/police/block-user")
async def police_block_user(req: PoliceBlockUserRequest, x_police_key: Optional[str] = Header(None)):
    blocked_by = _require_police(x_police_key)
    db = app.state.db
    now = utc_now()
    await db.blocked_users.update_one(
        {"user_id": req.user_id},
        {"$set": {"user_id": req.user_id, "reason": req.reason, "blocked_at": now, "blocked_by": blocked_by}},
        upsert=True,
    )
    return {"success": True, "user_id": req.user_id, "blocked_at": now}


@app.get("/police/blocked-users")
async def police_list_blocked_users(x_police_key: Optional[str] = Header(None), limit: int = 200):
    _require_police(x_police_key)
    db = app.state.db
    cursor = db.blocked_users.find({}).sort("blocked_at", -1).limit(max(1, min(limit, 500)))
    out = []
    async for doc in cursor:
        doc.pop("_id", None)
        out.append(doc)
    return out


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
