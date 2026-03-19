import os
from datetime import date, time

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Literal, List, Dict, Any
from datetime import datetime, timezone
from collections import deque
from time import perf_counter
from bson import ObjectId
import random

from .risk_engine import RiskEngine, RiskDecision
from .blockchain_registry import BlockchainRegistryClient, FraudRecord
from .db import create_client, ensure_indexes, get_db, utc_now
from .ledger import append_ledger_entry
from .context_signals import ip_reputation_from_ip, stable_hash


class TransactionRequest(BaseModel):
    user_id: str = Field(..., description="Anonymized user identifier")
    amount: float
    location: str
    device_id: str
    device_fingerprint: Optional[str] = Field(
        None, description="Optional stable device fingerprint (hashed or raw in demo)."
    )
    time: str = Field(..., description="HH:MM in 24h format (local user time)")
    merchant_id: str
    ip_address: Optional[str] = Field(
        None, description="Optional client IP (demo). Not persisted raw; only hashed for telemetry."
    )
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
    ledger_index: Optional[int] = Field(None, description="Ledger block index (present when persisted)")
    ledger_prev_hash: Optional[str] = Field(None, description="Ledger prev_hash (present when persisted)")
    registry_tx_hash: Optional[str] = Field(
        None,
        description="Deterministic transaction hash (can be submitted to an on-chain registry)",
    )
    model_loaded: bool = Field(..., description="Whether an ML model is loaded (else rule-only scoring).")
    balance_before: Optional[float] = Field(None, description="Wallet balance before this transaction (if wallet DB enabled).")
    balance_after: Optional[float] = Field(None, description="Wallet balance after this transaction (if wallet DB enabled).")


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

class PoliceUnblockUserRequest(BaseModel):
    user_id: str


class PoliceCreateTicketRequest(BaseModel):
    tx_id: str = Field(..., description="MongoDB transaction id (tx_id)")
    assigned_to: str = Field(..., min_length=1, max_length=64)
    notes: str = Field("", max_length=500)
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "HIGH"


class PoliceUpdateTicketRequest(BaseModel):
    status: Optional[Literal["OPEN", "IN_PROGRESS", "RESOLVED"]] = None
    assigned_to: Optional[str] = Field(None, max_length=64)
    notes: Optional[str] = Field(None, max_length=500)
    priority: Optional[Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]] = None


class PoliceTicket(BaseModel):
    ticket_id: str
    tx_id: str
    user_id: str
    device_id: str
    status: Literal["OPEN", "IN_PROGRESS", "RESOLVED"]
    priority: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    assigned_to: str
    notes: str
    created_at: datetime
    updated_at: datetime
    created_by: str


class BlockedUserEntry(BaseModel):
    user_id: str
    reason: str
    blocked_at: datetime
    blocked_by: str


class WalletUserResponse(BaseModel):
    user_id: str
    display_name: str
    balance: float
    currency: str = "RM"
    primary_device: str
    device_fingerprint: str
    location: str
    updated_at: datetime


def _default_wallet_user(user_id: str) -> Dict[str, Any]:
    # Fake-but-consistent defaults to make the UI feel real.
    suffix = user_id.split("_")[-1] if "_" in user_id else user_id[-3:]
    return {
        "user_id": user_id,
        "display_name": f"User {suffix}",
        "balance": 1240.50,
        "currency": "RM",
        "primary_device": "iPhone 15",
        "device_fingerprint": f"fp_demo_{suffix.zfill(3)}",
        "location": "Johor Bahru",
        "updated_at": utc_now(),
    }


async def _get_or_create_wallet_user(user_id: str) -> Dict[str, Any]:
    db = app.state.db
    existing = await db.wallet_users.find_one({"user_id": user_id})
    if existing is not None:
        existing.pop("_id", None)
        return existing
    doc = _default_wallet_user(user_id)
    await db.wallet_users.insert_one(doc)
    return doc


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


@app.get("/wallet/{user_id}", response_model=WalletUserResponse)
async def get_wallet_user(user_id: str):
    doc = await _get_or_create_wallet_user(user_id)
    return doc


@app.post("/wallet/{user_id}/reset", response_model=WalletUserResponse)
async def reset_wallet_user(user_id: str):
    db = app.state.db
    doc = _default_wallet_user(user_id)
    await db.wallet_users.update_one({"user_id": user_id}, {"$set": doc}, upsert=True)
    return doc


def _police_api_key() -> str:
    return os.getenv("POLICE_API_KEY", "police-demo-key")


def _police_bearer_token() -> str:
    return os.getenv("POLICE_BEARER_TOKEN", "police-demo-token")


def _require_police(x_police_key: Optional[str], authorization: Optional[str] = None) -> str:
    """
    Simple auth layer for police endpoints.

    Preferred: Authorization: Bearer <POLICE_BEARER_TOKEN>
    Legacy/demo: X-Police-Key: <POLICE_API_KEY>
    """
    bearer = _police_bearer_token()
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token and token == bearer:
            return "police"

    if x_police_key and x_police_key == _police_api_key():
        return "police"

    raise HTTPException(status_code=401, detail="Unauthorized (police credentials required)")


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


@app.post("/risk/score", response_model=TransactionResponse)
async def risk_score_only(tx: TransactionRequest):
    """
    Wallet-facing, low-latency scoring endpoint (no persistence).
    Prefer this for real-time checkout decisions.
    """
    t0 = perf_counter()

    blocked = await _is_user_blocked(tx.user_id)
    if blocked is not None:
        now = utc_now()
        return TransactionResponse(
            risk_score=1.0,
            decision="BLOCK",
            reason=f"User is blocked by police: {blocked.get('reason', 'policy')}",
            latency_ms=(perf_counter() - t0) * 1000.0,
            timestamp=now,
            model_loaded=risk_engine._model.is_loaded,  # demo visibility
        )

    derived_ip_rep = tx.ip_reputation
    if derived_ip_rep is None:
        derived_ip_rep = ip_reputation_from_ip(tx.ip_address)

    result = risk_engine.score_transaction(
        user_id=tx.user_id,
        amount=tx.amount,
        location=tx.location,
        device_id=tx.device_id,
        device_fingerprint=tx.device_fingerprint,
        time_str=tx.time,
        merchant_id=tx.merchant_id,
        ip_reputation=derived_ip_rep,
    )

    now = utc_now()
    return TransactionResponse(
        risk_score=result.risk_score,
        decision=result.decision,
        reason=result.reason,
        latency_ms=(perf_counter() - t0) * 1000.0,
        timestamp=now,
        model_loaded=risk_engine._model.is_loaded,  # demo visibility
    )


@app.post("/check-transaction", response_model=TransactionResponse)
async def check_transaction(tx: TransactionRequest):
    global _tx_counter
    t0 = perf_counter()

    blocked = await _is_user_blocked(tx.user_id)
    if blocked is not None:
        now = utc_now()
        return TransactionResponse(
            risk_score=1.0,
            decision="BLOCK",
            reason=f"User is blocked by police: {blocked.get('reason', 'policy')}",
            latency_ms=(perf_counter() - t0) * 1000.0,
            timestamp=now,
            model_loaded=risk_engine._model.is_loaded,
        )

    derived_ip_rep = tx.ip_reputation
    if derived_ip_rep is None:
        derived_ip_rep = ip_reputation_from_ip(tx.ip_address)

    result = risk_engine.score_transaction(
        user_id=tx.user_id,
        amount=tx.amount,
        location=tx.location,
        device_id=tx.device_id,
        device_fingerprint=tx.device_fingerprint,
        time_str=tx.time,
        merchant_id=tx.merchant_id,
        ip_reputation=derived_ip_rep,
    )

    now = utc_now()
    latency = (perf_counter() - t0) * 1000.0

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
        model_loaded=risk_engine._model.is_loaded,
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

    t0 = perf_counter()

    blocked = await _is_user_blocked(tx.user_id)
    derived_ip_rep: Optional[float] = tx.ip_reputation
    wallet_user = await _get_or_create_wallet_user(tx.user_id)
    balance_before = float(wallet_user.get("balance", 0.0))
    balance_after: Optional[float] = None
    if blocked is not None:
        now = utc_now()
        # Still persist the attempted transaction for audit trail
        result_decision: RiskDecision = "BLOCK"
        result_risk = 1.0
        result_reason = f"User is blocked by police: {blocked.get('reason', 'policy')}"
    else:
        if derived_ip_rep is None:
            derived_ip_rep = ip_reputation_from_ip(tx.ip_address)

        result = risk_engine.score_transaction(
            user_id=tx.user_id,
            amount=tx.amount,
            location=tx.location,
            device_id=tx.device_id,
            device_fingerprint=tx.device_fingerprint,
            time_str=tx.time,
            merchant_id=tx.merchant_id,
            ip_reputation=derived_ip_rep,
        )
        result_decision = result.decision
        result_risk = result.risk_score
        result_reason = result.reason
        if result_decision != "BLOCK":
            balance_after = max(0.0, balance_before - float(tx.amount))
            db = app.state.db
            await db.wallet_users.update_one(
                {"user_id": tx.user_id},
                {"$set": {"balance": balance_after, "updated_at": utc_now()}},
                upsert=True,
            )

    now = utc_now()
    latency = (perf_counter() - t0) * 1000.0

    ip_hash = stable_hash(tx.ip_address, prefix="ip") if tx.ip_address else None
    dev_fp_hash = stable_hash(tx.device_fingerprint, prefix="dev") if tx.device_fingerprint else None

    doc = {
        "user_id": tx.user_id,
        "amount": float(tx.amount),
        "location": tx.location,
        "device_id": tx.device_id,
        "device_fingerprint_hash": dev_fp_hash,
        "merchant_id": tx.merchant_id,
        "time_str": tx.time,
        "ip_reputation": derived_ip_rep if blocked is None else tx.ip_reputation,
        "ip_hash": ip_hash,
        "decision": result_decision,
        "risk_score": float(result_risk),
        "reason": result_reason,
        "latency_ms": float(latency),
        "balance_before": float(balance_before),
        "balance_after": float(balance_after) if balance_after is not None else None,
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
    ledger_index, ledger_prev_hash, ledger_hash = await append_ledger_entry(
        db, tx_object_id=ins.inserted_id, tx_payload=ledger_payload, created_at=now
    )

    # Deterministic "registry" tx hash: proof artifact even if on-chain reporting is disabled.
    registry_tx_hash = blockchain_client.compute_tx_hash(
        user_id=tx.user_id,
        amount=float(tx.amount),
        device_id=tx.device_id,
        timestamp_iso=now.isoformat(),
    )

    # Store proof fields back into transaction for easy retrieval
    await db.transactions.update_one(
        {"_id": ins.inserted_id},
        {
            "$set": {
                "ledger_hash": ledger_hash,
                "ledger_index": ledger_index,
                "ledger_prev_hash": ledger_prev_hash,
                "registry_tx_hash": registry_tx_hash,
            }
        },
    )

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
        ledger_index=ledger_index,
        ledger_prev_hash=ledger_prev_hash,
        registry_tx_hash=registry_tx_hash,
        model_loaded=risk_engine._model.is_loaded,
        balance_before=float(balance_before),
        balance_after=float(balance_after) if balance_after is not None else None,
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
    authorization: Optional[str] = Header(None),
):
    _require_police(x_police_key, authorization)
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
async def police_block_user(
    req: PoliceBlockUserRequest,
    x_police_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    blocked_by = _require_police(x_police_key, authorization)
    db = app.state.db
    now = utc_now()
    await db.blocked_users.update_one(
        {"user_id": req.user_id},
        {"$set": {"user_id": req.user_id, "reason": req.reason, "blocked_at": now, "blocked_by": blocked_by}},
        upsert=True,
    )
    return {"success": True, "user_id": req.user_id, "blocked_at": now}

@app.post("/police/unblock-user")
async def police_unblock_user(
    req: PoliceUnblockUserRequest,
    x_police_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    blocked_by = _require_police(x_police_key, authorization)
    db = app.state.db
    res = await db.blocked_users.delete_one({"user_id": req.user_id})
    return {"success": res.deleted_count > 0, "user_id": req.user_id, "unblocked_by": blocked_by}


def _make_ticket_id(now: datetime) -> str:
    ymd = now.strftime("%Y%m%d")
    rand = random.randint(1000, 9999)
    return f"TG-{ymd}-{rand}"


@app.post("/police/tickets", response_model=PoliceTicket)
async def police_create_ticket(
    req: PoliceCreateTicketRequest,
    x_police_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    created_by = _require_police(x_police_key, authorization)
    db = app.state.db
    now = utc_now()

    try:
        oid = ObjectId(req.tx_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid tx_id")

    tx = await db.transactions.find_one({"_id": oid})
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")

    existing = await db.police_tickets.find_one({"tx_id": req.tx_id, "status": {"$ne": "RESOLVED"}})
    if existing:
        existing["ticket_id"] = existing.get("ticket_id")
        existing["tx_id"] = existing.get("tx_id")
        existing["created_at"] = existing.get("created_at", now)
        existing["updated_at"] = existing.get("updated_at", now)
        return PoliceTicket(**existing)

    # Generate unique ticket id (retry a few times to avoid collision)
    ticket_id = _make_ticket_id(now)
    for _ in range(5):
        if await db.police_tickets.find_one({"ticket_id": ticket_id}) is None:
            break
        ticket_id = _make_ticket_id(now)

    doc = {
        "ticket_id": ticket_id,
        "tx_id": req.tx_id,
        "user_id": str(tx.get("user_id", "")),
        "device_id": str(tx.get("device_id", "")),
        "status": "OPEN",
        "priority": req.priority,
        "assigned_to": req.assigned_to,
        "notes": req.notes or "",
        "created_at": now,
        "updated_at": now,
        "created_by": created_by,
    }
    await db.police_tickets.insert_one(doc)
    return PoliceTicket(**doc)


@app.get("/police/tickets", response_model=List[PoliceTicket])
async def police_list_tickets(
    status: Optional[str] = None,
    limit: int = 100,
    x_police_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    _require_police(x_police_key, authorization)
    db = app.state.db
    q: Dict[str, Any] = {}
    if status and status.upper() in ("OPEN", "IN_PROGRESS", "RESOLVED"):
        q["status"] = status.upper()
    cursor = (
        db.police_tickets.find(q)
        .sort([("status", 1), ("priority", -1), ("updated_at", -1)])
        .limit(max(1, min(limit, 500)))
    )
    out: List[PoliceTicket] = []
    async for doc in cursor:
        doc.pop("_id", None)
        out.append(PoliceTicket(**doc))
    return out


@app.patch("/police/tickets/{ticket_id}", response_model=PoliceTicket)
async def police_update_ticket(
    ticket_id: str,
    req: PoliceUpdateTicketRequest,
    x_police_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    _require_police(x_police_key, authorization)
    db = app.state.db
    now = utc_now()

    patch: Dict[str, Any] = {"updated_at": now}
    if req.status:
        patch["status"] = req.status
    if req.priority:
        patch["priority"] = req.priority
    if req.assigned_to is not None:
        patch["assigned_to"] = req.assigned_to
    if req.notes is not None:
        patch["notes"] = req.notes

    await db.police_tickets.update_one({"ticket_id": ticket_id}, {"$set": patch})
    doc = await db.police_tickets.find_one({"ticket_id": ticket_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Ticket not found")
    doc.pop("_id", None)
    return PoliceTicket(**doc)


@app.get("/police/transactions/related")
async def police_related_transactions(
    tx_id: str,
    limit: int = 50,
    x_police_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    _require_police(x_police_key, authorization)
    db = app.state.db
    now = utc_now()
    start, end = _utc_day_range(now)

    try:
        oid = ObjectId(tx_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid tx_id")

    seed = await db.transactions.find_one({"_id": oid})
    if not seed:
        raise HTTPException(status_code=404, detail="Transaction not found")

    user_id = seed.get("user_id")
    device_id = seed.get("device_id")
    ip_hash = seed.get("ip_hash")
    dev_fp_hash = seed.get("device_fingerprint_hash")

    or_terms: List[Dict[str, Any]] = []
    if user_id:
        or_terms.append({"user_id": user_id})
    if device_id:
        or_terms.append({"device_id": device_id})
    if ip_hash:
        or_terms.append({"ip_hash": ip_hash})
    if dev_fp_hash:
        or_terms.append({"device_fingerprint_hash": dev_fp_hash})

    if not or_terms:
        return {"seed": {"tx_id": tx_id}, "related": [], "links": {}}

    q = {"created_at": {"$gte": start, "$lte": end}, "$or": or_terms}
    cursor = db.transactions.find(q).sort("created_at", -1).limit(max(1, min(limit, 200)))

    related = []
    async for doc in cursor:
        txid = str(doc.pop("_id"))
        doc["tx_id"] = txid
        related.append(doc)

    links = {
        "user_id": user_id,
        "device_id": device_id,
        "ip_hash": ip_hash,
        "device_fingerprint_hash": dev_fp_hash,
        "ledger_hash": seed.get("ledger_hash"),
        "registry_tx_hash": seed.get("registry_tx_hash"),
    }
    return {"seed": {"tx_id": tx_id, "user_id": user_id, "device_id": device_id}, "related": related, "links": links}

@app.get("/police/blocked-users")
async def police_list_blocked_users(
    x_police_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    limit: int = 200,
):
    _require_police(x_police_key, authorization)
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


@app.get("/stats/overview-today")
async def stats_overview_today() -> Dict[str, Any]:
    """
    MongoDB-backed stats for today's persisted transactions.
    Use this for dashboards so data survives backend restarts.
    """
    now = utc_now()
    start, end = _utc_day_range(now)
    db = app.state.db

    total = 0
    blocked = 0
    flagged = 0
    approved = 0

    cursor = db.transactions.find({"created_at": {"$gte": start, "$lte": end}}, {"decision": 1})
    async for doc in cursor:
        total += 1
        d = doc.get("decision")
        if d == "BLOCK":
            blocked += 1
        elif d == "FLAG":
            flagged += 1
        elif d == "APPROVE":
            approved += 1

    fraud_rate = (blocked / total) if total > 0 else 0.0
    return {
        "total_transactions": total,
        "blocked": blocked,
        "flagged": flagged,
        "approved": approved,
        "fraud_rate": round(fraud_rate, 4),
    }


@app.get("/stats/recent")
def stats_recent(limit: int = 50) -> List[TransactionLogEntry]:
    return list(list(_tx_log)[: max(0, min(limit, len(_tx_log)))])


@app.get("/stats/recent-today")
async def stats_recent_today(limit: int = 50) -> List[Dict[str, Any]]:
    """
    MongoDB-backed recent transactions (today only).
    Returns a lightweight list similar to /stats/recent.
    """
    now = utc_now()
    start, end = _utc_day_range(now)
    db = app.state.db
    cursor = (
        db.transactions.find({"created_at": {"$gte": start, "$lte": end}})
        .sort("created_at", -1)
        .limit(max(1, min(limit, 200)))
    )
    out: List[Dict[str, Any]] = []
    i = 0
    async for doc in cursor:
        i += 1
        out.append(
            {
                "id": i,
                "user_id": doc.get("user_id"),
                "amount": float(doc.get("amount", 0.0)),
                "location": doc.get("location", ""),
                "device_id": doc.get("device_id", ""),
                "merchant_id": doc.get("merchant_id", ""),
                "decision": doc.get("decision", "APPROVE"),
                "risk_score": float(doc.get("risk_score", 0.0)),
                "timestamp": doc.get("created_at", now).isoformat(),
            }
        )
    return out


@app.get("/stats/risk-distribution")
def stats_risk_distribution(buckets: int = 10):
    counts = [0] * buckets
    for t in _tx_log:
        idx = min(buckets - 1, int(t.risk_score * buckets))
        counts[idx] += 1
    return {"buckets": buckets, "counts": counts}


@app.get("/stats/risk-distribution-today")
async def stats_risk_distribution_today(buckets: int = 10):
    """
    MongoDB-backed risk distribution for today's persisted transactions.
    """
    b = max(2, min(int(buckets), 50))
    counts = [0] * b
    now = utc_now()
    start, end = _utc_day_range(now)
    db = app.state.db
    cursor = db.transactions.find({"created_at": {"$gte": start, "$lte": end}}, {"risk_score": 1})
    async for doc in cursor:
        try:
            r = float(doc.get("risk_score", 0.0))
        except Exception:
            r = 0.0
        r = max(0.0, min(1.0, r))
        idx = min(b - 1, int(r * b))
        counts[idx] += 1
    return {"buckets": b, "counts": counts}


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
