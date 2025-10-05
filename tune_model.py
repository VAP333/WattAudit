# tune_model.py (hybrid normalized scoring + persistence-aware tuning)

import os
import pandas as pd
import numpy as np
import joblib
import optuna
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import f1_score

# -------- Paths --------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODEL_DIR, exist_ok=True)

df = pd.read_csv(os.path.join(DATA_DIR, "training_with_synthetics.csv"))
features = ["consumption_kwh", "billed_kwh", "ratio", "monthly_change", "cat_dev", "billing_gap"]
X = df[features].fillna(0)
y = df["is_synthetic"].apply(lambda x: -1 if x == 1 else 1)

# -------- Objective Function --------
def objective(trial):
    # Sample hyperparameters
    iso_cont = trial.suggest_float("iso_contamination", 0.005, 0.1)
    n_estimators = trial.suggest_int("n_estimators", 50, 300)
    max_samples = trial.suggest_float("max_samples", 0.5, 1.0)
    lof_n_neighbors = trial.suggest_int("lof_n_neighbors", 10, 50)
    lof_cont = trial.suggest_float("lof_contamination", 0.005, 0.1)
    alpha = trial.suggest_float("alpha", 0.3, 0.9)
    under_cutoff = trial.suggest_float("under_cutoff", 0.75, 0.9)
    over_cutoff = trial.suggest_float("over_cutoff", 1.2, 1.4)

    # -------- Isolation Forest --------
    iso = IsolationForest(
        contamination=iso_cont,
        n_estimators=n_estimators,
        max_samples=max_samples,
        random_state=42
    )
    iso_scores = iso.fit(X).decision_function(X)

    # -------- LOF (novelty=True for scoring consistency) --------
    lof = LocalOutlierFactor(
        n_neighbors=lof_n_neighbors,
        contamination=lof_cont,
        novelty=True
    )
    lof.fit(X)
    lof_pred = lof.predict(X)

    # -------- Normalize Scores --------
    scaler = MinMaxScaler()
    iso_norm = scaler.fit_transform(iso_scores.reshape(-1, 1)).ravel()
    lof_norm = scaler.fit_transform(np.abs(lof_pred).reshape(-1, 1)).ravel()

    combined_score = alpha * iso_norm + (1 - alpha) * lof_norm

    # -------- Rule-based Anomalies (under + over billing) --------
    under_flag = (df["ratio"] < under_cutoff).astype(int)
    over_flag = (df["ratio"] > over_cutoff).astype(int)
    rule_flag = under_flag | over_flag

    # Apply mild rule penalty
    final_score = combined_score - rule_flag * 0.2

    # -------- Anomaly Threshold --------
    threshold = np.percentile(final_score, 5)
    preds = np.where(final_score < threshold, -1, 1)

    # -------- Persistence Factor --------
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
    persistence_weight = df_temp["persistent_anomaly"].mean()  # average persistence

    # -------- F1 Score --------
    f1 = f1_score(y, preds, pos_label=-1, zero_division=0)

    # Encourage models that catch persistent anomalies
    score = f1 * (0.9 + 0.1 * persistence_weight)
    return score

# -------- Run Study --------
study = optuna.create_study(direction="maximize")
study.optimize(objective, n_trials=50)

print("✅ Best params found:")
for k, v in study.best_params.items():
    print(f"  {k}: {v}")
print(f"✅ Best F1 (persistence-weighted): {study.best_value:.4f}")

# -------- Save Best Parameters --------
best_params = study.best_params
joblib.dump(best_params, os.path.join(MODEL_DIR, "best_params.pkl"))

# -------- Save Results --------
results_path = os.path.join(DATA_DIR, "tuning_results.csv")
df_results = pd.DataFrame([{**study.best_params, "best_f1": study.best_value}])
if os.path.exists(results_path):
    old = pd.read_csv(results_path)
    df_results = pd.concat([old, df_results], ignore_index=True)
df_results.to_csv(results_path, index=False)

print(f"📊 Tuning results saved to {results_path}")
print("⚡ Hybrid anomaly logic: normalized IF+LOF, under+over rules, persistence weighting.")
