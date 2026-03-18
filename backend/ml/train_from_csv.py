from __future__ import annotations

import argparse
from pathlib import Path
from typing import Optional

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


def _read_csv(path: Path) -> pd.DataFrame:
    encodings = ["utf-8", "utf-8-sig", "utf-16", "utf-16le", "latin1"]
    last_err: Optional[Exception] = None
    for enc in encodings:
        try:
            return pd.read_csv(path, encoding=enc, low_memory=False)
        except Exception as e:
            last_err = e
    raise RuntimeError(f"Failed to read CSV {path} with tried encodings: {encodings}") from last_err


def _coerce_numeric(series: pd.Series, default: float = 0.0) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(default)


def _parse_hour(df: pd.DataFrame, *, time_col: Optional[str]) -> pd.Series:
    """
    Accepts:
    - numeric seconds since first txn (Kaggle creditcard `Time`)
    - ISO datetime strings
    - HH:MM strings
    Falls back to 0 if missing.
    """
    if not time_col or time_col not in df.columns:
        return pd.Series(np.zeros(len(df), dtype=int), index=df.index)

    s = df[time_col]
    # Try numeric seconds → hour
    if pd.api.types.is_numeric_dtype(s) or _coerce_numeric(s, default=np.nan).notna().mean() > 0.95:
        sec = _coerce_numeric(s, default=0.0).astype(float)
        return np.floor((sec / 3600.0) % 24).astype(int)

    # Try datetime / time strings
    parsed = pd.to_datetime(s, errors="coerce", utc=True)
    if parsed.notna().any():
        return parsed.dt.hour.fillna(0).astype(int)

    # Try HH:MM
    as_str = s.astype("string").fillna("00:00")
    hh = as_str.str.split(":").str[0]
    return _coerce_numeric(hh, default=0).clip(lower=0, upper=23).astype(int)


def engineer_features(
    df: pd.DataFrame,
    *,
    amount_col: str,
    label_col: str,
    time_col: Optional[str],
    user_col: Optional[str],
    device_col: Optional[str],
    location_col: Optional[str],
    ip_rep_col: Optional[str],
) -> tuple[pd.DataFrame, pd.Series]:
    if amount_col not in df.columns:
        raise ValueError(f"Missing amount column: {amount_col}")
    if label_col not in df.columns:
        raise ValueError(f"Missing label column: {label_col}")

    out = pd.DataFrame(index=df.index)
    out["amount"] = _coerce_numeric(df[amount_col], default=0.0).astype(float)
    out["hour"] = _parse_hour(df, time_col=time_col).astype(int)

    if ip_rep_col and ip_rep_col in df.columns:
        out["ip_reputation"] = _coerce_numeric(df[ip_rep_col], default=0.5).clip(0.0, 1.0).astype(float)
    else:
        out["ip_reputation"] = 0.5

    # History-based features (requires user identity); otherwise fall back to global stats
    if user_col and user_col in df.columns:
        user_key = df[user_col].astype("string").fillna("NA")
        sort_cols = [user_col]
        if time_col and time_col in df.columns:
            sort_cols.append(time_col)
        tmp = df.copy()
        tmp["_user_key"] = user_key
        tmp["_amount"] = out["amount"]
        tmp = tmp.sort_values(sort_cols, kind="mergesort")

        g = tmp.groupby("_user_key", sort=False)
        prior_mean = g["_amount"].expanding().mean().shift(1).reset_index(level=0, drop=True)
        prior_mean = prior_mean.fillna(tmp["_amount"].median() if len(tmp) else 1.0)
        amount_ratio = (tmp["_amount"] / prior_mean.clip(lower=1.0)).astype(float)
        out.loc[tmp.index, "amount_ratio"] = amount_ratio

        if device_col and device_col in df.columns:
            dev = tmp[device_col].astype("string").fillna("NA")
            last_dev = g[device_col].shift(1).astype("string")
            out.loc[tmp.index, "is_new_device"] = ((dev != last_dev) & last_dev.notna()).astype(float)
        else:
            out["is_new_device"] = 0.0

        if location_col and location_col in df.columns:
            loc = tmp[location_col].astype("string").fillna("NA")
            last_loc = g[location_col].shift(1).astype("string")
            out.loc[tmp.index, "is_new_location"] = ((loc != last_loc) & last_loc.notna()).astype(float)
        else:
            out["is_new_location"] = 0.0
    else:
        global_mean = float(out["amount"].mean() if len(out) else 1.0)
        out["amount_ratio"] = (out["amount"] / max(global_mean, 1.0)).astype(float)
        out["is_new_device"] = 0.0
        out["is_new_location"] = 0.0

    # Clean
    feature_names = ["amount", "hour", "ip_reputation", "amount_ratio", "is_new_device", "is_new_location"]
    for c in feature_names:
        out[c] = _coerce_numeric(out[c], default=0.0).astype(float)

    y = _coerce_numeric(df[label_col], default=0).astype(int).clip(lower=0, upper=1)
    return out[feature_names], y


def train(
    *,
    data: str,
    output_dir: str,
    amount_col: str,
    label_col: str,
    time_col: Optional[str],
    user_col: Optional[str],
    device_col: Optional[str],
    location_col: Optional[str],
    ip_rep_col: Optional[str],
    threshold: float,
    test_size: float,
    seed: int,
    smote: bool,
    smote_ratio: float,
    smote_k: int,
) -> None:
    data_path = Path(data)
    if not data_path.is_absolute():
        data_path = (REPO_ROOT / data_path).resolve()
    if not data_path.exists():
        raise FileNotFoundError(f"Missing dataset file: {data_path}")

    df = _read_csv(data_path)
    X, y = engineer_features(
        df,
        amount_col=amount_col,
        label_col=label_col,
        time_col=time_col,
        user_col=user_col,
        device_col=device_col,
        location_col=location_col,
        ip_rep_col=ip_rep_col,
    )

    class_counts = y.value_counts().to_dict()
    print(f"Label distribution: {class_counts}")

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=test_size,
        stratify=y if len(class_counts) > 1 else None,
        random_state=seed,
    )

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    model = None
    if len(class_counts) <= 1:
        print("WARNING: label has only one class. Saving scaler + feature names only.")
    else:
        fraud_ratio = float((y == 1).mean())
        scale_pos_weight = (1.0 - fraud_ratio) / max(fraud_ratio, 1e-6)

        X_fit = X_train_scaled
        y_fit = y_train.to_numpy()
        if smote:
            ratio = float(min(max(smote_ratio, 0.01), 1.0))
            k = int(max(1, smote_k))
            print(f"Applying SMOTE (sampling_strategy={ratio}, k_neighbors={k}) ...")
            sm = SMOTE(random_state=seed, sampling_strategy=ratio, k_neighbors=k)
            X_fit, y_fit = sm.fit_resample(X_train_scaled, y_fit)

        model = XGBClassifier(
            n_estimators=500,
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
        y_pred = (y_prob > float(threshold)).astype(int)
        print(f"Model evaluation (threshold={threshold})")
        print(classification_report(y_test, y_pred, digits=4))

    out_dir = Path(output_dir)
    if not out_dir.is_absolute():
        out_dir = (REPO_ROOT / out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    dump(
        {
            "model": model,
            "scaler": scaler,
            "feature_names": X.columns.tolist(),
            "threshold": float(threshold),
            "source": str(data_path),
        },
        out_dir / "fraud_xgb_model.joblib",
    )
    print(f"Saved: {out_dir / 'fraud_xgb_model.joblib'}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(
        description=(
            "Train TrustGuard XGBoost model from an arbitrary CSV using column mappings.\n"
            "Outputs a model compatible with backend real-time inference."
        )
    )
    p.add_argument("--data", required=True, help="Path to CSV (e.g. Kaggle Credit Card Fraud or custom export).")
    p.add_argument("--output-dir", default=str(BACKEND_ROOT / "models"), help="Where to write fraud_xgb_model.joblib")

    p.add_argument("--amount-col", default="amount", help="Amount column name (e.g. Amount, TransactionAmt).")
    p.add_argument("--label-col", default="is_fraud", help="Fraud label column name (0/1) (e.g. Class, isFraud).")
    p.add_argument("--time-col", default=None, help="Time column name (e.g. Time, TransactionDT, timestamp).")
    p.add_argument("--user-col", default=None, help="User/account column (optional).")
    p.add_argument("--device-col", default=None, help="Device/fingerprint column (optional).")
    p.add_argument("--location-col", default=None, help="Location/geo column (optional).")
    p.add_argument("--ip-rep-col", default=None, help="IP reputation score column in [0,1] (optional).")

    p.add_argument("--threshold", type=float, default=0.35, help="Probability threshold for metrics reporting.")
    p.add_argument("--test-size", type=float, default=0.2)
    p.add_argument("--seed", type=int, default=42)

    p.add_argument("--smote", action="store_true")
    p.add_argument("--smote-ratio", type=float, default=0.2)
    p.add_argument("--smote-k", type=int, default=5)

    args = p.parse_args()
    train(
        data=args.data,
        output_dir=args.output_dir,
        amount_col=args.amount_col,
        label_col=args.label_col,
        time_col=args.time_col,
        user_col=args.user_col,
        device_col=args.device_col,
        location_col=args.location_col,
        ip_rep_col=args.ip_rep_col,
        threshold=args.threshold,
        test_size=args.test_size,
        seed=args.seed,
        smote=bool(args.smote),
        smote_ratio=float(args.smote_ratio),
        smote_k=int(args.smote_k),
    )

