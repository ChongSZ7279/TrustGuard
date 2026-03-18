from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from motor.motor_asyncio import AsyncIOMotorDatabase


def _stable_json(obj: Dict[str, Any]) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_block_hash(*, prev_hash: str, payload: Dict[str, Any], timestamp: datetime) -> str:
    msg = f"{prev_hash}|{timestamp.isoformat()}|{_stable_json(payload)}".encode("utf-8")
    return "0x" + hashlib.sha256(msg).hexdigest()


async def append_ledger_entry(
    db: AsyncIOMotorDatabase,
    *,
    tx_object_id: Any,
    tx_payload: Dict[str, Any],
    created_at: datetime,
) -> Tuple[int, str, str]:
    """
    Append a tamper-evident ledger entry in MongoDB.
    This is a lightweight "blockchain" for demo purposes:
      - each entry stores prev_hash and its own hash
      - hash commits to tx payload + timestamp + prev_hash
    """
    last = await db.ledger.find_one(sort=[("index", -1)])
    prev_hash = (last or {}).get("hash", "0x" + "0" * 64)
    index = int((last or {}).get("index", 0)) + 1

    payload = {
        "tx_object_id": str(tx_object_id),
        **tx_payload,
    }
    block_hash = compute_block_hash(prev_hash=prev_hash, payload=payload, timestamp=created_at)

    await db.ledger.insert_one(
        {
            "index": index,
            "prev_hash": prev_hash,
            "hash": block_hash,
            "tx_object_id": tx_object_id,
            "created_at": created_at,
        }
    )

    return index, prev_hash, block_hash

