import asyncio
import os
from datetime import datetime

from motor.motor_asyncio import AsyncIOMotorClient


async def main() -> None:
    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    mongodb_db = os.getenv("MONGODB_DB", "trustguard")

    client = AsyncIOMotorClient(mongodb_uri)
    db = client[mongodb_db]

    # Verify prev_hash chaining in ledger collection
    prev_hash = "0x" + "0" * 64
    ok = True
    count = 0

    cursor = db.ledger.find({}, {"index": 1, "prev_hash": 1, "hash": 1, "tx_object_id": 1, "created_at": 1}).sort("index", 1)
    async for entry in cursor:
        count += 1
        i = entry.get("index")
        entry_prev = entry.get("prev_hash")
        entry_hash = entry.get("hash")

        if entry_prev != prev_hash:
            ok = False
            print(f"[FAIL] ledger index={i}: expected prev_hash={prev_hash} but found prev_hash={entry_prev}")
            break

        # If the transaction doc exists, verify it references this ledger hash + index
        tx_object_id = entry.get("tx_object_id")
        if tx_object_id is not None:
            tx_doc = await db.transactions.find_one(
                {"_id": tx_object_id},
                {"ledger_hash": 1, "ledger_index": 1, "ledger_prev_hash": 1},
            )
            if tx_doc:
                if tx_doc.get("ledger_hash") != entry_hash:
                    ok = False
                    print(
                        f"[FAIL] tx ledger_hash mismatch for tx_object_id={tx_object_id}: "
                        f"tx.ledger_hash={tx_doc.get('ledger_hash')} ledger.hash={entry_hash}"
                    )
                    break
                if tx_doc.get("ledger_index") != i:
                    ok = False
                    print(
                        f"[FAIL] tx ledger_index mismatch for tx_object_id={tx_object_id}: "
                        f"tx.ledger_index={tx_doc.get('ledger_index')} ledger.index={i}"
                    )
                    break
                if tx_doc.get("ledger_prev_hash") != entry_prev:
                    ok = False
                    print(
                        f"[FAIL] tx ledger_prev_hash mismatch for tx_object_id={tx_object_id}: "
                        f"tx.ledger_prev_hash={tx_doc.get('ledger_prev_hash')} ledger.prev_hash={entry_prev}"
                    )
                    break

        prev_hash = entry_hash

    if ok:
        print(f"[OK] Ledger chain verified for {count} entries.")
    else:
        print("[ERROR] Ledger chain verification failed.")


if __name__ == "__main__":
    asyncio.run(main())

