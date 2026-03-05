from typing import Optional
from dataclasses import dataclass
import hashlib


@dataclass
class FraudRecord:
    transaction_hash: str
    risk_score: float


class BlockchainRegistryClient:
    """
    Optional Ethereum fraud registry integration.

    For hackathon demos this is intentionally a lightweight stub:
    - It computes a transaction hash locally.
    - The same hash can be submitted to the Solidity contract on a public testnet
      (e.g. Sepolia) using free tools like Remix or Hardhat.
    - No private keys or RPC URLs are handled in this backend.
    """

    def __init__(self, enabled: bool = False):
        self.enabled = enabled

    def is_enabled(self) -> bool:
        return self.enabled

    def compute_tx_hash(self, *, user_id: str, amount: float, device_id: str, timestamp_iso: str) -> str:
        payload = f"{user_id}|{amount}|{device_id}|{timestamp_iso}".encode("utf-8")
        return "0x" + hashlib.sha256(payload).hexdigest()

    def report_fraud(self, record: FraudRecord) -> Optional[str]:
        if not self.enabled:
            return None
        # In a real integration, use web3.py here to call reportFraud(transactionHash, riskScore)
        # on the deployed contract. For now we just return the hash to be used manually.
        return record.transaction_hash

