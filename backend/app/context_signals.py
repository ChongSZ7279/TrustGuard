from __future__ import annotations

import hashlib
from typing import Optional


def stable_hash(value: str, *, prefix: str = "h") -> str:
    """
    Privacy-first: deterministic hash for storing/telemetry without raw identifiers.
    Not meant for cryptographic security guarantees in this prototype.
    """
    v = (value or "").encode("utf-8", errors="ignore")
    return f"{prefix}_{hashlib.sha256(v).hexdigest()[:24]}"


def ip_reputation_from_ip(ip_address: Optional[str]) -> Optional[float]:
    """
    Demo heuristic:
    - If IP is missing -> None (let caller decide defaulting)
    - If IP falls into a small known-bad demo set -> low score
    - Else: deterministic pseudo-score in [0.35, 0.95] based on hash
    """
    if not ip_address:
        return None

    ip = ip_address.strip()
    known_bad = {
        "10.0.0.66",
        "203.0.113.13",
        "198.51.100.99",
    }
    if ip in known_bad:
        return 0.05

    h = hashlib.sha256(ip.encode("utf-8", errors="ignore")).digest()
    bucket = h[0] / 255.0
    return float(0.35 + bucket * 0.60)

