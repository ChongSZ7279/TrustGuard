from dataclasses import dataclass
from typing import Dict, Optional, Literal
from datetime import datetime
import math
import threading

from .ml_inference import FraudModel


RiskDecision = Literal["APPROVE", "FLAG", "BLOCK"]


@dataclass
class RiskResult:
    risk_score: float
    decision: RiskDecision
    reason: str


class UserBehaviorProfile:
    """
    Simple in-memory behavioral baseline.

    In a production system this would be persisted in a database like MongoDB
    and updated using streaming aggregation jobs.
    """

    def __init__(self):
        self.tx_count = 0
        self.total_amount = 0.0
        self.amount_sq_sum = 0.0
        self.hour_hist = [0] * 24
        self.locations: Dict[str, int] = {}
        self.devices: Dict[str, int] = {}
        self.merchants: Dict[str, int] = {}

    def update(self, amount: float, hour: int, location: str, device_id: str, merchant_id: str):
        self.tx_count += 1
        self.total_amount += amount
        self.amount_sq_sum += amount * amount
        self.hour_hist[hour] += 1
        self.locations[location] = self.locations.get(location, 0) + 1
        self.devices[device_id] = self.devices.get(device_id, 0) + 1
        self.merchants[merchant_id] = self.merchants.get(merchant_id, 0) + 1

    @property
    def avg_amount(self) -> float:
        if self.tx_count == 0:
            return 0.0
        return self.total_amount / self.tx_count

    @property
    def std_amount(self) -> float:
        if self.tx_count <= 1:
            return 0.0
        mean = self.avg_amount
        var = self.amount_sq_sum / self.tx_count - mean * mean
        return math.sqrt(max(var, 0.0))

    def most_common_location(self) -> Optional[str]:
        if not self.locations:
            return None
        return max(self.locations.items(), key=lambda kv: kv[1])[0]

    def most_common_device(self) -> Optional[str]:
        if not self.devices:
            return None
        return max(self.devices.items(), key=lambda kv: kv[1])[0]

    def most_common_merchants(self, top_k: int = 3):
        return sorted(self.merchants.items(), key=lambda kv: kv[1], reverse=True)[:top_k]

    def as_dict(self):
        return {
            "tx_count": self.tx_count,
            "avg_amount": self.avg_amount,
            "std_amount": self.std_amount,
            "hour_hist": self.hour_hist,
            "most_common_location": self.most_common_location(),
            "most_common_device": self.most_common_device(),
            "frequent_merchants": [m for m, _ in self.most_common_merchants()],
        }


class RiskEngine:
    def __init__(self):
        self._profiles: Dict[str, UserBehaviorProfile] = {}
        self._lock = threading.Lock()
        self._model = FraudModel()

    def _get_or_create_profile(self, user_id: str) -> UserBehaviorProfile:
        with self._lock:
            if user_id not in self._profiles:
                self._profiles[user_id] = UserBehaviorProfile()
            return self._profiles[user_id]

    def get_user_profile(self, user_id: str):
        profile = self._profiles.get(user_id)
        return profile.as_dict() if profile else None

    def score_transaction(
        self,
        user_id: str,
        amount: float,
        location: str,
        device_id: str,
        time_str: str,
        merchant_id: str,
        ip_reputation: Optional[float],
    ) -> RiskResult:
        try:
            hour = int(time_str.split(":")[0])
        except Exception:
            hour = datetime.utcnow().hour

        profile = self._get_or_create_profile(user_id)

        features = {}
        reasons = []
        risk = 0.0

        avg_amount = profile.avg_amount or 1.0
        amount_ratio = amount / max(avg_amount, 1.0)
        features["amount_ratio"] = amount_ratio
        if profile.tx_count >= 5 and amount_ratio > 5:
            risk += 0.35
            reasons.append("Unusually high amount vs baseline")
        elif amount_ratio > 10:
            risk += 0.45
            reasons.append("Extremely high amount vs limited history")

        std_amount = profile.std_amount
        if std_amount > 0:
            z_score = (amount - avg_amount) / std_amount
            features["amount_z"] = z_score
            if z_score > 3:
                risk += 0.25
                reasons.append("Amount more than 3σ above mean")

        common_loc = profile.most_common_location()
        if common_loc and location != common_loc:
            risk += 0.2
            reasons.append("Unusual location vs baseline")

        common_dev = profile.most_common_device()
        if common_dev and device_id != common_dev:
            risk += 0.2
            reasons.append("New or rare device vs baseline")

        night = hour < 6 or hour > 23
        day = 6 <= hour <= 21
        if day and profile.tx_count > 0:
            daytime_txs = sum(profile.hour_hist[6:22])
            night_txs = profile.hour_hist[0] + sum(profile.hour_hist[22:24])
            if night and daytime_txs > night_txs:
                risk += 0.15
                reasons.append("Transaction at unusual time vs baseline")

        if ip_reputation is not None:
            if ip_reputation < 0.3:
                risk += 0.2
                reasons.append("Very poor IP reputation")
            elif ip_reputation < 0.6:
                risk += 0.1
                reasons.append("Moderate IP risk")

        if common_dev and common_loc and device_id != common_dev and location != common_loc:
            risk += 0.2
            reasons.append("New device and different country/location detected")

        primary_merchant_ids = {m for m, _ in profile.most_common_merchants()}
        if profile.tx_count >= 5 and merchant_id not in primary_merchant_ids:
            risk += 0.1
            reasons.append("Unusual merchant category vs baseline")

        if self._model.is_loaded:
            model_features = {
                "amount": amount,
                "hour": hour,
                "ip_reputation": ip_reputation or 0.0,
                "amount_ratio": amount_ratio,
                "is_new_device": float(common_dev is not None and device_id != common_dev),
                "is_new_location": float(common_loc is not None and location != common_loc),
            }
            ml_prob = self._model.predict_proba(model_features)
            if ml_prob is not None:
                reasons.append(f"ML fraud probability={ml_prob:.3f}")
                risk = 0.6 * ml_prob + 0.4 * risk

        risk = max(0.0, min(1.0, risk))

        if risk < 0.30:
            decision: RiskDecision = "APPROVE"
        elif risk < 0.70:
            decision = "FLAG"
        else:
            decision = "BLOCK"

        threshold = 50.0
        if decision != "BLOCK" and amount > threshold and ip_reputation is not None and ip_reputation < 0.4:
            decision = "BLOCK"
            risk = max(risk, 0.8)
            reasons.append("High amount combined with risky IP")

        profile.update(amount=amount, hour=hour, location=location, device_id=device_id, merchant_id=merchant_id)

        if not reasons:
            reasons.append("Within normal behavioral baseline")

        return RiskResult(
            risk_score=round(risk, 4),
            decision=decision,
            reason="; ".join(reasons),
        )

