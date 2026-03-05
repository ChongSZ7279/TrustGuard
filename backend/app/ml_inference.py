from pathlib import Path
from typing import Optional, Dict, Any

import numpy as np
from joblib import load


class FraudModel:
    """
    Lightweight wrapper around a trained XGBoost fraud model.
    If the model file is missing, this class becomes a no-op and returns None.
    """

    def __init__(self, model_path: str = "backend/models/fraud_xgb_model.joblib"):
        self.model_path = Path(model_path)
        self._model = None
        self._scaler = None
        self._feature_names = None
        self._load()

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def _load(self):
        if not self.model_path.exists():
            return
        payload = load(self.model_path)
        self._model = payload["model"]
        self._scaler = payload["scaler"]
        self._feature_names = payload["feature_names"]

    def predict_proba(self, features: Dict[str, Any]) -> Optional[float]:
        if not self.is_loaded:
            return None

        x = np.zeros((1, len(self._feature_names)), dtype=float)
        for i, name in enumerate(self._feature_names):
            x[0, i] = float(features.get(name, 0.0))

        x_scaled = self._scaler.transform(x)
        prob = float(self._model.predict_proba(x_scaled)[0, 1])
        return prob

