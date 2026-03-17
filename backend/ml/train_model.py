from pathlib import Path
import argparse

import pandas as pd
from imblearn.over_sampling import SMOTE
from joblib import dump
from sklearn.metrics import classification_report
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier


BACKEND_ROOT = Path(__file__).resolve().parents[1]


# -----------------------------
# 1️⃣ Load PaySim Dataset
# -----------------------------
def load_dataset(path: str) -> pd.DataFrame:
    """
    Load the PaySim CSV and perform basic cleaning so that
    all remaining columns are numeric after one‑hot encoding.

    You can pass either:
    - 'paysim.csv'          (in backend/ml/)
    - 'ml/paysim.csv'       (from backend/)
    - an absolute path.
    """
    input_path = Path(path)

    # If user passed a relative path, resolve it from backend root.
    if not input_path.is_absolute():
        # Try as‑is from backend root
        candidate = BACKEND_ROOT / input_path
        if candidate.exists():
            input_path = candidate
        else:
            # If it's just a file name, also try backend/ml/<name>
            if input_path.parent == Path("."):
                alt = BACKEND_ROOT / "ml" / input_path.name
                if alt.exists():
                    input_path = alt

    if not input_path.exists():
        raise FileNotFoundError(f"Could not find dataset CSV at '{path}' (resolved to '{input_path}')")

    df = pd.read_csv(input_path)

    # Drop obvious row/id columns and raw account IDs
    df = df.drop(columns=["Unnamed: 0", "nameOrig", "nameDest"], errors="ignore")

    return df


# -----------------------------
# 2️⃣ Behavioral Feature Engineering (PaySim)
# -----------------------------
def behavioral_features(df: pd.DataFrame) -> pd.DataFrame:
    # Balance changes for origin and destination
    df["balance_change_orig"] = df["oldbalanceOrg"] - df["newbalanceOrig"]
    df["balance_change_dest"] = df["newbalanceDest"] - df["oldbalanceDest"]

    # Ratios to previous balances (add 1 to avoid division by zero)
    df["amount_ratio_orig"] = df["amount"] / (df["oldbalanceOrg"] + 1.0)
    df["amount_ratio_dest"] = df["amount"] / (df["oldbalanceDest"] + 1.0)

    # Simple consistency checks between amount and balance deltas
    df["transaction_error_orig"] = df["amount"] - df["balance_change_orig"]
    df["transaction_error_dest"] = df["amount"] - df["balance_change_dest"]

    return df


# -----------------------------
# 3️⃣ Time Features (from PaySim `step`)
# -----------------------------
def time_features(df: pd.DataFrame) -> pd.DataFrame:
    # `step` is in hours; derive hour-of-day and day index
    df["hour"] = df["step"] % 24
    df["day"] = df["step"] // 24

    # Simple night flag
    df["is_night"] = ((df["hour"] < 6) | (df["hour"] > 22)).astype(int)

    return df


# -----------------------------
# 4️⃣ Training Pipeline
# -----------------------------
def train_model(dataset_path: str) -> None:
    print(f"Loading dataset from {dataset_path} ...")
    df = load_dataset(dataset_path)

    print("Creating behavioral features...")
    df = behavioral_features(df)

    print("Creating time features...")
    df = time_features(df)

    # -------------------------
    # Labels
    # -------------------------
    if "isFraud" not in df.columns:
        raise ValueError("Expected 'isFraud' column in dataset.")

    y = df["isFraud"].astype(int)
    class_counts = y.value_counts().to_dict()
    print(f"Label distribution: {class_counts}")

    # -------------------------
    # Features
    # -------------------------
    X = df.drop(columns=["isFraud", "isFlaggedFraud"], errors="ignore")

    # Automatically one‑hot encode ALL remaining categorical/object/string columns
    cat_cols = X.select_dtypes(include=["object", "string"]).columns.tolist()
    if cat_cols:
        X = pd.get_dummies(X, columns=cat_cols, drop_first=True)

    feature_names = X.columns.tolist()

    # -------------------------
    # Train/Test Split
    # -------------------------
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        stratify=y if len(class_counts) > 1 else None,
        random_state=42,
    )

    # -------------------------
    # Standardization
    # -------------------------
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    # Default threshold (used both in full and fallback cases)
    threshold = 0.35

    if len(class_counts) <= 1:
        # Fallback: dataset has no positive fraud labels.
        # We cannot use SMOTE or train a meaningful classifier.
        # In this case we only save the scaler + feature names so that
        # the backend can still load them. The model will be None and
        # thus ignored by `FraudModel` (it will fall back to rules).
        print(
            "WARNING: 'isFraud' has only one class in this dataset. "
            "Skipping SMOTE and model training; saving scaler and features only."
        )
        model = None
    else:
        # -------------------------
        # Handle Class Imbalance with SMOTE
        # -------------------------
        # print("Applying SMOTE...")
        # smote = SMOTE(random_state=42)
        # X_resampled, y_resampled = smote.fit_resample(X_train_scaled, y_train)

        # -------------------------
        # Train XGBoost
        # -------------------------
        print("Training model...")
        fraud_ratio = (y == 1).mean()
        scale_pos_weight = (1 - fraud_ratio) / max(fraud_ratio, 1e-6)

        model = XGBClassifier(
            n_estimators=300,
            max_depth=6,
            learning_rate=0.1,
            subsample=0.9,
            colsample_bytree=0.9,
            objective="binary:logistic",
            eval_metric="logloss",
            tree_method="hist",
            scale_pos_weight=scale_pos_weight,
            n_jobs=-1,
        )

        # model.fit(X_resampled, y_resampled)
        model.fit(X_train_scaled, y_train)
        
        # -------------------------
        # Evaluation
        # -------------------------
        y_prob = model.predict_proba(X_test_scaled)[:, 1]
        y_pred = (y_prob > threshold).astype(int)

        print("Model Evaluation")
        print(classification_report(y_test, y_pred))

    # -------------------------
    # Save Model (for backend `FraudModel`)
    # -------------------------
    # If you call this from the backend root, this directory will exist already.
    # If you call it from elsewhere, it's still a nice default.
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train XGBoost fraud model on PaySim-style data.")
    parser.add_argument(
        "--data",
        "-d",
        required=True,
        help="Path to the PaySim CSV file (e.g. paysim.csv or ml/paysim.csv).",
    )

    args = parser.parse_args()
    train_model(args.data)

    