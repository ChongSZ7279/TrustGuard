from __future__ import annotations

import argparse
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import pandas as pd
from joblib import dump
from imblearn.over_sampling import SMOTE
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = REPO_ROOT / "backend"
DATA_DIR_DEFAULT = BACKEND_ROOT / "ml" / "data"


def _resolve_path(path: str | Path) -> Path:
    p = Path(path)
    if p.is_absolute():
        return p
    candidate = (REPO_ROOT / p).resolve()
    if candidate.exists():
        return candidate
    alt = (DATA_DIR_DEFAULT / p).resolve()
    return alt


def _read_csv_safely(path: Path, usecols: Optional[Iterable[str]] = None) -> pd.DataFrame:
    """
    Some CSVs (especially Excel-exported) may be UTF-16 encoded.
    Try a small set of encodings for robustness.
    """
    encodings = ["utf-8", "utf-8-sig", "utf-16", "utf-16le", "latin1"]
    last_err: Optional[Exception] = None
    for enc in encodings:
        try:
            # Use low_memory + on_bad_lines='skip' to reduce RAM pressure and
            # avoid failing on a small number of malformed rows in very large CSVs.
            return pd.read_csv(
                path,
                usecols=usecols,
                encoding=enc,
                low_memory=True,
                on_bad_lines="skip",
            )
        except Exception as e:
            last_err = e
    raise RuntimeError(f"Failed to read CSV {path} with tried encodings: {encodings}") from last_err


def _make_user_key(tx: pd.DataFrame) -> pd.Series:
    """
    IEEE-CIS doesn't provide a direct user_id. For a real-time "unbanked" setting
    we emulate an account holder using stable payment instrument + location hints.
    """
    parts = []
    for col in ["card1", "card2", "card3", "card5", "addr1", "addr2"]:
        if col in tx.columns:
            parts.append(tx[col].astype("string").fillna("NA"))
    if not parts:
        return pd.Series(["global"] * len(tx), index=tx.index)
    key = parts[0]
    for p in parts[1:]:
        key = key + "|" + p
    return key


def _engineer_realtime_features(merged: pd.DataFrame) -> pd.DataFrame:
    """
    Produce features that match what `backend/app/risk_engine.py` sends to the ML model:
      - amount
      - hour
      - ip_reputation
      - amount_ratio
      - is_new_device
      - is_new_location

    We build them from the dataset using proxy fields:
      - amount: TransactionAmt
      - hour: derived from TransactionDT (seconds offset)
      - device: DeviceType + DeviceInfo (from identity) when available
      - location: addr1 + addr2 (from transaction) when available
      - user: derived key from card*/addr* fields
    """
    df = merged.copy()

    if "TransactionAmt" not in df.columns or "TransactionDT" not in df.columns:
        raise ValueError("Expected TransactionAmt and TransactionDT in merged dataset.")

    df["amount"] = pd.to_numeric(df["TransactionAmt"], errors="coerce").fillna(0.0).astype(float)
    dt_hours = (pd.to_numeric(df["TransactionDT"], errors="coerce").fillna(0.0) / 3600.0).astype(float)
    df["hour"] = np.floor(dt_hours % 24).astype(int)

    user_key = _make_user_key(df)
    df["_user_key"] = user_key

    # Sort chronologically to avoid leakage in history-based features
    df = df.sort_values(["_user_key", "TransactionDT"], kind="mergesort")

    # Amount ratio vs prior mean amount for the same user
    g = df.groupby("_user_key", sort=False)
    prior_mean = g["amount"].expanding().mean().shift(1).reset_index(level=0, drop=True)
    prior_mean = prior_mean.fillna(df["amount"].median() if len(df) else 1.0)
    df["amount_ratio"] = (df["amount"] / (prior_mean.clip(lower=1.0))).astype(float)

    # "New device" proxy
    device_cols = [c for c in ["DeviceType", "DeviceInfo"] if c in df.columns]
    if device_cols:
        device_key = df[device_cols[0]].astype("string").fillna("NA")
        for c in device_cols[1:]:
            device_key = device_key + "|" + df[c].astype("string").fillna("NA")
        df["_device_key"] = device_key
        last_device = g["_device_key"].shift(1)
        df["is_new_device"] = ((df["_device_key"] != last_device) & last_device.notna()).astype(float)
    else:
        df["is_new_device"] = 0.0

    # "New location" proxy
    loc_parts = []
    for c in ["addr1", "addr2"]:
        if c in df.columns:
            loc_parts.append(df[c].astype("string").fillna("NA"))
    if loc_parts:
        loc_key = loc_parts[0]
        for p in loc_parts[1:]:
            loc_key = loc_key + "|" + p
        df["_loc_key"] = loc_key
        last_loc = g["_loc_key"].shift(1)
        df["is_new_location"] = ((df["_loc_key"] != last_loc) & last_loc.notna()).astype(float)
    else:
        df["is_new_location"] = 0.0

    # Keep only real-time features and label (others are "unused data")
    # NOTE: IEEE-CIS doesn't include an explicit IP reputation score. We keep the feature anyway
    # so the real-time service can pass a meaningful contextual signal at inference time.
    df["ip_reputation"] = 0.5

    keep = ["amount", "hour", "ip_reputation", "amount_ratio", "is_new_device", "is_new_location"]
    out = df[keep].copy()

    # Ensure finite values for downstream scaler/model
    for c in keep:
        out[c] = pd.to_numeric(out[c], errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0.0).astype(float)

    return out


def load_ieee_dataset(data_dir: Path) -> pd.DataFrame:
    train_tx_path = _resolve_path(data_dir / "train_transaction.csv")
    train_id_path = _resolve_path(data_dir / "train_identity.csv")

    if not train_tx_path.exists():
        raise FileNotFoundError(f"Missing {train_tx_path}")
    if not train_id_path.exists():
        raise FileNotFoundError(f"Missing {train_id_path}")

    tx_usecols = [
        "TransactionID",
        "isFraud",
        "TransactionDT",
        "TransactionAmt",
        "card1",
        "card2",
        "card3",
        "card5",
        "addr1",
        "addr2",
    ]
    tx = _read_csv_safely(train_tx_path, usecols=tx_usecols)

    # Identity header sometimes uses id-01 vs id_01, but we only need device fields for the real-time features.
    id_usecols = ["TransactionID", "DeviceType", "DeviceInfo"]
    ident = _read_csv_safely(train_id_path, usecols=id_usecols)

    merged = tx.merge(ident, on="TransactionID", how="left")
    return merged


def train_model(
    data_dir: str,
    *,
    test_size: float = 0.2,
    random_state: int = 42,
    use_smote: bool = False,
    smote_ratio: float = 0.2,
    smote_k_neighbors: int = 5,
) -> None:
    data_path = _resolve_path(data_dir)
    print(f"Loading IEEE-CIS style dataset from {data_path} ...")
    merged = load_ieee_dataset(data_path)

    if "isFraud" not in merged.columns:
        raise ValueError("Expected 'isFraud' column in train_transaction.csv.")

    y_raw = merged["isFraud"].astype(int)
    class_counts = y_raw.value_counts().to_dict()
    print(f"Label distribution: {class_counts}")

    print("Engineering real-time features (filtering unused columns)...")
    X = _engineer_realtime_features(merged)
    # X is time-sorted; align labels to the same row order
    y = y_raw.loc[X.index]
    feature_names = X.columns.tolist()

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=test_size,
        stratify=y if len(class_counts) > 1 else None,
        random_state=random_state,
    )

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    threshold = 0.35

    if len(class_counts) <= 1:
        print(
            "WARNING: 'isFraud' has only one class in this dataset. "
            "Skipping model training; saving scaler and feature names only."
        )
        model = None
    else:
        print("Training XGBoost model...")
        fraud_ratio = float((y == 1).mean())
        scale_pos_weight = (1.0 - fraud_ratio) / max(fraud_ratio, 1e-6)

        X_fit = X_train_scaled
        y_fit = y_train.to_numpy()
        if use_smote:
            # SMOTE can aggressively inflate the dataset. For fraud problems,
            # bringing minority up to a modest ratio often works better.
            ratio = float(min(max(smote_ratio, 0.01), 1.0))
            k = int(max(1, smote_k_neighbors))
            print(f"Applying SMOTE (sampling_strategy={ratio}, k_neighbors={k}) ...")
            smote = SMOTE(random_state=random_state, sampling_strategy=ratio, k_neighbors=k)
            X_fit, y_fit = smote.fit_resample(X_train_scaled, y_fit)

        model = XGBClassifier(
            n_estimators=400,
            max_depth=5,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.9,
            reg_lambda=1.0,
            objective="binary:logistic",
            eval_metric="logloss",
            tree_method="hist",
            scale_pos_weight=scale_pos_weight,
            n_jobs=-1,
        )

        model.fit(X_fit, y_fit)

        y_prob = model.predict_proba(X_test_scaled)[:, 1]
        y_pred = (y_prob > threshold).astype(int)
        print("Model evaluation (threshold=0.35)")
        print(classification_report(y_test, y_pred, digits=4))

    output_dir = Path("backend/models") if Path("backend").exists() else Path("models")
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / "fraud_xgb_model.joblib"

    dump(
        {
            "model": model,
            "scaler": scaler,
            "feature_names": feature_names,
            "threshold": threshold,
        },
        model_path,
    )

    print(f"Model saved to: {model_path}")
    print(f"Feature names: {feature_names}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Train XGBoost fraud model on IEEE-CIS identity+transaction data.\n"
            "Case study: Digital Trust – Real-Time Fraud Shield for the Unbanked.\n"
            "The model is trained on real-time-derivable features to match backend inference."
        )
    )
    parser.add_argument(
        "--data-dir",
        default=str(DATA_DIR_DEFAULT),
        help="Directory containing train_transaction.csv and train_identity.csv (default: backend/ml/data).",
    )
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--smote",
        action="store_true",
        help="Enable SMOTE oversampling on the training split (recommended: use with --smote-ratio).",
    )
    parser.add_argument(
        "--smote-ratio",
        type=float,
        default=0.2,
        help="SMOTE sampling_strategy ratio for minority class (0.01–1.0). Example: 0.2 makes fraud ~=20% of majority.",
    )
    parser.add_argument(
        "--smote-k",
        type=int,
        default=5,
        help="SMOTE k_neighbors (lower this if minority count is small).",
    )

    args = parser.parse_args()
    train_model(
        data_dir=args.data_dir,
        test_size=args.test_size,
        random_state=args.seed,
        use_smote=bool(args.smote),
        smote_ratio=float(args.smote_ratio),
        smote_k_neighbors=int(args.smote_k),
    )
    