# tune_model.py

import os
import pandas as pd
import numpy as np
import joblib
import optuna
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
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
    # Sample parameters
    iso_cont = trial.suggest_float("iso_contamination", 0.005, 0.1)
    n_estimators = trial.suggest_int("n_estimators", 50, 300)
    max_samples = trial.suggest_float("max_samples", 0.5, 1.0)
    lof_n_neighbors = trial.suggest_int("lof_n_neighbors", 10, 50)
    lof_cont = trial.suggest_float("lof_contamination", 0.005, 0.1)
    rule_cutoff = trial.suggest_float("rule_cutoff", 0.7, 0.95)
    alpha = trial.suggest_float("alpha", 0.3, 0.9)

    # Train IsolationForest
    iso = IsolationForest(
        contamination=iso_cont,
        n_estimators=n_estimators,
        max_samples=max_samples,
        random_state=42
    )
    iso_val = iso.fit(X).decision_function(X)

    # Train LOF (novelty=True allows reuse for scoring)
    lof = LocalOutlierFactor(
        n_neighbors=lof_n_neighbors,
        contamination=lof_cont,
        novelty=True
    )
    lof.fit(X)
    lof_scores = lof.predict(X)

    # Rule-based
    rule_flags = (df["ratio"] < rule_cutoff).astype(int)

    # Hybrid scoring
    final_score = alpha * iso_val + (1 - alpha) * lof_scores - rule_flags * 2

    # Threshold at bottom 5%
    threshold = np.percentile(final_score, 5)
    preds = np.where(final_score <= threshold, -1, 1)

    # Evaluate F1
    return f1_score(y, preds, pos_label=-1, zero_division=0)

# -------- Run Study --------
study = optuna.create_study(direction="maximize")
study.optimize(objective, n_trials=50)

print("✅ Best params:", study.best_params)
print("✅ Best F1:", study.best_value)

# Save best parameters for reuse
best_params = study.best_params
joblib.dump(best_params, os.path.join(MODEL_DIR, "best_params.pkl"))

# Save results to CSV for record keeping
results_path = os.path.join(DATA_DIR, "tuning_results.csv")
df_results = pd.DataFrame([{
    **study.best_params,
    "best_f1": study.best_value
}])
if os.path.exists(results_path):
    old = pd.read_csv(results_path)
    df_results = pd.concat([old, df_results], ignore_index=True)
df_results.to_csv(results_path, index=False)
print(f"📊 Tuning results saved to {results_path}")
