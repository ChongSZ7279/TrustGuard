import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from imblearn.over_sampling import SMOTE
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier
from joblib import dump


def load_dataset(csv_path: Path, label_column: str):
    df = pd.read_csv(csv_path)
    y = df[label_column].astype(int).values
    X = df.drop(columns=[label_column])
    X = pd.get_dummies(X, drop_first=True)
    return X.values.astype(float), y, X.columns.tolist()


def main():
    parser = argparse.ArgumentParser(description="Train fraud detection model with SMOTE and class weighting.")
    parser.add_argument("--data", type=str, required=True, help="Path to CSV dataset (e.g. Kaggle fraud data).")
    parser.add_argument("--label-column", type=str, default="is_fraud", help="Name of the binary fraud label column.")
    parser.add_argument("--output-dir", type=str, default="models", help="Directory to save trained model artifacts.")
    args = parser.parse_args()

    csv_path = Path(args.data)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    X, y, feature_names = load_dataset(csv_path, args.label_column)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    sm = SMOTE(random_state=42)
    X_res, y_res = sm.fit_resample(X_train_scaled, y_train)

    fraud_ratio = (y == 1).mean() or 0.001
    scale_pos_weight = max(1.0, (1 - fraud_ratio) / fraud_ratio)

    model = XGBClassifier(
        n_estimators=200,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        scale_pos_weight=scale_pos_weight,
        n_jobs=-1,
    )

    model.fit(X_res, y_res)

    y_pred = model.predict(X_test_scaled)
    y_prob = model.predict_proba(X_test_scaled)[:, 1]

    print("Classification report on test set:")
    print(classification_report(y_test, y_pred, digits=4))

    dump(
        {
            "model": model,
            "scaler": scaler,
            "feature_names": feature_names,
        },
        out_dir / "fraud_xgb_model.joblib",
    )

    print(f"Saved model to {out_dir / 'fraud_xgb_model.joblib'}")


if __name__ == "__main__":
    main()

