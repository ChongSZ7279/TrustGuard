from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase


def utc_now() -> datetime:
    return datetime.utcnow().replace(tzinfo=timezone.utc)


def get_mongodb_uri() -> str:
    return os.getenv("MONGODB_URI", "mongodb://localhost:27017")


def get_db_name() -> str:
    return os.getenv("MONGODB_DB", "trustguard")


def create_client() -> AsyncIOMotorClient:
    return AsyncIOMotorClient(get_mongodb_uri())


def get_db(client: AsyncIOMotorClient) -> AsyncIOMotorDatabase:
    return client[get_db_name()]


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    # Transactions: query by day and user quickly
    await db.transactions.create_index([("created_at", -1)])
    await db.transactions.create_index([("user_id", 1), ("created_at", -1)])

    # Blocklist: lookup by user_id
    await db.blocked_users.create_index("user_id", unique=True)
    await db.blocked_users.create_index([("blocked_at", -1)])

    # Ledger: sequential index, plus tx reference
    await db.ledger.create_index("index", unique=True)
    await db.ledger.create_index([("created_at", -1)])

