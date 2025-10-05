# tune_and_train.py (hybrid normalized scoring + persistence-aware grid search)

import os
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from itertools import product
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import precision_score, recall_score, f1_score

# ---------- Paths ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "models")
REPORT_DIR = os.path.join(BASE_DIR, "reports")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

# ---------- Load Dataset ----------
training_with_synthetics_path = os.path.join(DATA_DIR, "training_with_synthetics.csv")
if not os.path.exists(training_with_synthetics_path):
    raise FileNotFoundError("❌ Run train_model.py first to generate training_with_synthetics.csv")

df = pd.read_csv(training_with_synthetics_path, parse_dates=["month"])
print(f"✅ Loaded {len(df)} records from training_with_synthetics.csv")

features = ["consumption_kwh", "billed_kwh", "ratio", "monthly_change", "cat_dev", "billing_gap"]
X = df[features].fillna(0)
y_true = df["is_synthetic"].apply(lambda x: -1 if x == 1 else 1).values

# ---------- Helper Functions ----------
def evaluate_combo(X, df, params):
    """Train IF+LOF hybrid and compute persistence-weighted F1."""
    # --- Isolation Forest ---
    iso = IsolationForest(
        contamination=params["iso_contamination"],
        n_estimators=params["n_estimators"],
        max_samples=params["max_samples"],
        random_state=42
    )
    iso_scores = iso.fit(X).decision_function(X)

    # --- LOF (novelty=True for stable scoring) ---
    lof = LocalOutlierFactor(
        n_neighbors=params["lof_n_neighbors"],
        contamination=params["lof_contamination"],
        novelty=True
    )
    lof.fit(X)
    lof_pred = lof.predict(X)

    # --- Normalize both ---
    scaler = MinMaxScaler()
    iso_norm = scaler.fit_transform(iso_scores.reshape(-1, 1)).ravel()
    lof_norm = scaler.fit_transform(np.abs(lof_pred).reshape(-1, 1)).ravel()

    alpha = params["alpha"]
    combined_score = alpha * iso_norm + (1 - alpha) * lof_norm

    # --- Rule-based flags (under + over) ---
    under_flag = (df["ratio"] < params["under_cutoff"]).astype(int)
    over_flag = (df["ratio"] > params["over_cutoff"]).astype(int)
    rule_flag = under_flag | over_flag

    # Mild rule penalty
    final_score = combined_score - rule_flag * 0.2

    # --- Thresholding ---
    threshold = np.percentile(final_score, params["threshold_pct"])
    preds = np.where(final_score < threshold, -1, 1)

    # --- Persistence filter ---
    df_temp = df.copy()
    df_temp["anomaly_label"] = preds
    df_temp["persistent_anomaly"] = (
        df_temp.groupby("customer_id")["anomaly_label"]
        .rolling(2)
        .sum()
        .reset_index(0, drop=True)
        .ge(2)
        .astype(int)
    )
    persistence_weight = df_temp["persistent_anomaly"].mean()

    # --- Metrics ---
    precision = precision_score(y_true, preds, pos_label=-1, zero_division=0)
    recall = recall_score(y_true, preds, pos_label=-1, zero_division=0)
    f1 = f1_score(y_true, preds, pos_label=-1, zero_division=0)

    # Persistence-weighted F1
    f1_weighted = f1 * (0.9 + 0.1 * persistence_weight)

    return {
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "f1_weighted": f1_weighted,
        "iso": iso,
        "lof": lof,
    }

# ---------- Parameter Grid ----------
grid = {
    "iso_contamination": [0.01, 0.03, 0.05],
    "n_estimators": [100, 200],
    "max_samples": [0.6, 0.8],
    "lof_n_neighbors": [10, 20],
    "lof_contamination": [0.01, 0.05],
    "alpha": [0.5, 0.7, 0.9],
    "under_cutoff": [0.8, 0.85, 0.9],
    "over_cutoff": [1.25, 1.3, 1.35],
    "threshold_pct": [5],
}

param_list = [dict(zip(grid.keys(), v)) for v in product(*grid.values())]
print(f"⚙️ Evaluating {len(param_list)} parameter combinations...")

# ---------- Run Tuning ----------
results = []
best = {"f1_weighted": -1.0}

for i, params in enumerate(param_list, 1):
    res = evaluate_combo(X, df, params)
    row = params.copy()
    row.update({
        "precision": res["precision"],
        "recall": res["recall"],
        "f1": res["f1"],
        "f1_weighted": res["f1_weighted"]
    })
    results.append(row)

    if res["f1_weighted"] > best["f1_weighted"]:
        best = {"params": params, **res}

    if i % 10 == 0 or i == len(param_list):
        print(f"[{i}/{len(param_list)}] f1={res['f1']:.3f} f1w={res['f1_weighted']:.3f} "
              f"prec={res['precision']:.3f} rec={res['recall']:.3f}")

# ---------- Save Tuning Results ----------
tuning_df = pd.DataFrame(results)
tuning_path = os.path.join(REPORT_DIR, "tuning_results.csv")
tuning_df.to_csv(tuning_path, index=False)
print(f"✅ Tuning results saved to {tuning_path}")

# ---------- Save Best Model ----------
best_params = best["params"]
print("\n🏆 Best Parameters Found:")
for k, v in best_params.items():
    print(f"  {k}: {v}")

joblib.dump(best_params, os.path.join(MODEL_DIR, "best_params.pkl"))
joblib.dump(best["iso"], os.path.join(MODEL_DIR, "best_isolation_forest.pkl"))

meta = {
    "best_params": best_params,
    "best_metrics": {
        "precision": best["precision"],
        "recall": best["recall"],
        "f1": best["f1"],
        "f1_weighted": best["f1_weighted"],
    },
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
}
with open(os.path.join(MODEL_DIR, "best_model_meta.json"), "w") as f:
    json.dump(meta, f, indent=2)

print("\n✅ Best model and metadata saved.")
print("🎯 Best metrics:", meta["best_metrics"])
print("⚡ Hybrid logic: normalized IF+LOF, dual rule thresholds, persistence-aware F1.")
