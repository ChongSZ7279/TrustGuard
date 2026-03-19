import argparse
import asyncio
import json
import os
from datetime import datetime
from typing import Any, Dict, Optional

from motor.motor_asyncio import AsyncIOMotorClient


def risk_score_to_bps(risk_score: Any) -> int:
    try:
        r = float(risk_score)
    except Exception:
        r = 0.0
    # riskScoreBps in the Solidity contract expects 0..10000
    return max(0, min(10000, int(round(r * 10000))))


async def main() -> None:
    parser = argparse.ArgumentParser(description="Export blocked tx registry hashes for FraudRegistry.sol")
    parser.add_argument("--out", default="blocked_registry_reports.jsonl", help="Output JSONL file")
    parser.add_argument("--limit", type=int, default=500, help="Max number of reports to export")
    args = parser.parse_args()

    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongodb_db = os.getenv("MONGODB_DB", "trustguard")

    client = AsyncIOMotorClient(mongodb_uri)
    db = client[mongodb_db]

    cursor = db.transactions.find(
        {
            "decision": "BLOCK",
            "registry_tx_hash": {"$exists": True, "$ne": None},
            "registry_tx_hash": {"$type": "string"},
        },
        {
            "tx_id": 1,
            "user_id": 1,
            "amount": 1,
            "device_id": 1,
            "created_at": 1,
            "risk_score": 1,
            "registry_tx_hash": 1,
        },
    ).sort("created_at", -1)

    out_path = args.out
    exported = 0
    with open(out_path, "w", encoding="utf-8") as f:
        async for doc in cursor:
            if exported >= args.limit:
                break
            registry_hash = doc.get("registry_tx_hash")
            if not isinstance(registry_hash, str) or not registry_hash.startswith("0x"):
                continue

            risk_bps = risk_score_to_bps(doc.get("risk_score", 0.0))
            created_at = doc.get("created_at")
            if isinstance(created_at, datetime):
                created_iso = created_at.isoformat()
            else:
                created_iso = str(created_at) if created_at is not None else ""

            payload: Dict[str, Any] = {
                "transactionHash": registry_hash,  # bytes32
                "riskScoreBps": risk_bps,
                "tx_id": doc.get("tx_id"),
                "user_id": doc.get("user_id"),
                "amount": doc.get("amount"),
                "device_id": doc.get("device_id"),
                "created_at": created_iso,
            }
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
            exported += 1

    print(f"Exported {exported} blocked registry proofs to {out_path}")


if __name__ == "__main__":
    asyncio.run(main())

