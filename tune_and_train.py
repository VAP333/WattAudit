# tune_and_train.py
"""
Grid-tune IsolationForest + LOF hybrid pipeline using synthetic labels.
Saves:
 - models/best_isolation_forest.pkl
 - models/best_model_meta.json
 - reports/tuning_results.csv
"""

import os
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.metrics import precision_score, recall_score, f1_score

# ---------- Helpers ----------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "models")
REPORT_DIR = os.path.join(BASE_DIR, "reports")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

# Try to import your synthetic injection utility (support both names)
inject_fn = None
try:
    from utils.synthetic import inject_synthetic_anomalies_per_customer as inject_fn
except Exception:
    try:
        from utils.synthetic import inject_synthetic_anomalies as inject_fn
    except Exception:
        inject_fn = None

def add_features(df):
    df = df.sort_values(["customer_id", "month"])
    df = df.copy()
    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df.groupby("customer_id")["consumption_kwh"].diff().fillna(0)
    category_avg = df.groupby("consumer_category")["consumption_kwh"].transform("mean")
    df["cat_dev"] = df["consumption_kwh"] - category_avg
    df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]
    return df

def split_by_customer(df, train_frac=0.7, seed=42):
    rng = np.random.RandomState(seed)
    customers = df["customer_id"].unique()
    customers = rng.permutation(customers)
    k = int(len(customers) * train_frac)
    train_cust = set(customers[:k])
    train_df = df[df["customer_id"].isin(train_cust)].reset_index(drop=True)
    val_df = df[~df["customer_id"].isin(train_cust)].reset_index(drop=True)
    return train_df, val_df

def evaluate_combo(train_df, val_df, features, params):
    # Train IsolationForest on train
    iso = IsolationForest(contamination=params["iso_contamination"],
                          n_estimators=params["n_estimators"],
                          max_samples=params["max_samples"],
                          random_state=params["seed"])
    iso.fit(train_df[features].fillna(0))

    # LOF as novelty model (fit on train, score val)
    lof = LocalOutlierFactor(n_neighbors=params["lof_n_neighbors"],
                              novelty=True,
                              contamination=params["lof_contamination"])
    lof.fit(train_df[features].fillna(0))

    iso_val = iso.decision_function(val_df[features].fillna(0))  # higher -> more normal
    lof_val = lof.decision_function(val_df[features].fillna(0))  # higher -> more normal

    rule_flag = (val_df["ratio"] < params["rule_ratio_cutoff"]).astype(int)

    # final score (higher more normal). We'll detect anomalies as lowest final_score
    final_score = params["alpha"] * iso_val + (1.0 - params["alpha"]) * lof_val - params["rule_weight"] * rule_flag

    # mark bottom X percentile as anomalies
    threshold = np.percentile(final_score, params["threshold_pct"])
    pred = np.where(final_score <= threshold, -1, 1)

    # true labels from synthetic injection: -1 for synthetic anomaly else 1
    if "is_synthetic" in val_df.columns:
        y_true = val_df["is_synthetic"].apply(lambda x: -1 if int(x) == 1 else 1).values
    else:
        # fallback: pick a small random set (not ideal)
        y_true = np.ones(len(val_df), dtype=int)
        idx = np.random.RandomState(params["seed"]).choice(len(val_df), size=max(1, int(0.01*len(val_df))), replace=False)
        y_true[idx] = -1

    precision = precision_score(y_true, pred, pos_label=-1, zero_division=0)
    recall = recall_score(y_true, pred, pos_label=-1, zero_division=0)
    f1 = f1_score(y_true, pred, pos_label=-1, zero_division=0)

    return {"precision": precision, "recall": recall, "f1": f1, "iso": iso, "lof": lof}

# ---------- Load dataset ----------
# Prefer training_with_synthetics if exist, else base + injection
training_with_synthetics_path = os.path.join(DATA_DIR, "training_with_synthetics.csv")
if os.path.exists(training_with_synthetics_path):
    df = pd.read_csv(training_with_synthetics_path, parse_dates=["month"])
    df = add_features(df)
    print(f"Loaded {training_with_synthetics_path}")
else:
    base_path = os.path.join(DATA_DIR, "dummy_billing_dataset.csv")
    df = pd.read_csv(base_path, parse_dates=["month"])
    if inject_fn is not None:
        df = add_features(df)
        df = inject_fn(df, customer_frac=0.05, months_frac=0.25, seed=42)
        df = add_features(df)  # recompute features after injection
        # persist so evaluation scripts can reuse
        df.to_csv(training_with_synthetics_path, index=False)
        print(f"Injected synthetic anomalies and saved to {training_with_synthetics_path}")
    else:
        raise RuntimeError("No synthetic injection function found (utils.synthetic). Please add it or run train_model.py first.")

# ---------- Split ----------
train_df, val_df = split_by_customer(df, train_frac=0.7, seed=42)
features = ["consumption_kwh", "billed_kwh", "ratio", "monthly_change", "cat_dev", "billing_gap"]

# ---------- Grid ----------
grid = {
    "iso_contamination": [0.01, 0.03, 0.05],
    "n_estimators": [100],
    "max_samples": [0.6, "auto"],
    "lof_n_neighbors": [10, 20],
    "lof_contamination": [0.01, 0.03],   # used only for LOF's internal decision, but novelty=True will let us score
    "alpha": [0.7, 0.85, 1.0],           # weight of IsolationForest in final score
    "rule_weight": [0, 2],               # how strongly we subtract rule flags
    "rule_ratio_cutoff": [0.85],         # single value for now
    "threshold_pct": [2, 5],             # bottom-X percentile treated as anomaly
    "seed": [42]
}

# produce param list
from itertools import product
keys, values = zip(*grid.items())
param_list = [dict(zip(keys, v)) for v in product(*values)]

results = []
best = {"f1": -1.0}
print(f"Running {len(param_list)} combinations...")

for i, params in enumerate(param_list, 1):
    res = evaluate_combo(train_df, val_df, features, params)
    row = params.copy()
    row.update({"precision": res["precision"], "recall": res["recall"], "f1": res["f1"]})
    results.append(row)

    # keep best by f1 (tie-breaker: precision)
    if res["f1"] > best["f1"] or (res["f1"] == best["f1"] and res["precision"] > best.get("precision", 0)):
        best = {"params": params, "f1": res["f1"], "precision": res["precision"], "recall": res["recall"]}
    if i % 10 == 0 or i == len(param_list):
        print(f"[{i}/{len(param_list)}] f1={res['f1']:.3f} prec={res['precision']:.3f} recall={res['recall']:.3f}")

# Save the tuning table
tuning_df = pd.DataFrame(results)
tuning_path = os.path.join(REPORT_DIR, "tuning_results.csv")
tuning_df.to_csv(tuning_path, index=False)
print(f"Tuning table saved to {tuning_path}")

# ---------- Train final best model on FULL dataset ----------
best_params = best["params"]
print("Best params:", best_params)
# train ISO on full df features
iso_final = IsolationForest(contamination=best_params["iso_contamination"],
                            n_estimators=best_params["n_estimators"],
                            max_samples=best_params["max_samples"],
                            random_state=best_params["seed"])
iso_final.fit(df[features].fillna(0))

# save model + meta
joblib.dump(iso_final, os.path.join(MODEL_DIR, "best_isolation_forest.pkl"))

meta = {
    "best_params": best_params,
    "best_metrics": {"precision": best["precision"], "recall": best["recall"], "f1": best["f1"]},
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
}
with open(os.path.join(MODEL_DIR, "best_model_meta.json"), "w") as f:
    json.dump(meta, f, indent=2)

print("Saved best model and metadata to models/")
print("Best metrics:", meta["best_metrics"])
