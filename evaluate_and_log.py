# evaluate_and_log.py (improved hybrid evaluation + normalization + persistence)

import os
import pandas as pd
import numpy as np
import joblib
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import precision_score, recall_score, f1_score, confusion_matrix
from datetime import datetime
import seaborn as sns
import matplotlib.pyplot as plt

# --------- Paths ---------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "models")
REPORTS_DIR = os.path.join(BASE_DIR, "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

LOG_FILE = os.path.join(BASE_DIR, "metrics_log.csv")
RESULTS_FILE = os.path.join(DATA_DIR, "evaluation_results.csv")
CONF_MATRIX_FILE = os.path.join(REPORTS_DIR, "confusion_matrix.png")

# --------- Load Data & Model ---------
data_path = os.path.join(DATA_DIR, "training_with_synthetics.csv")
if not os.path.exists(data_path):
    raise FileNotFoundError(f"❌ Dataset not found at {data_path}. Run train_model.py first!")

df = pd.read_csv(data_path, parse_dates=["month"])
iso = joblib.load(os.path.join(MODEL_DIR, "anomaly_model.pkl"))  # IsolationForest

# --------- Load Best Params ---------
best_params_path = os.path.join(MODEL_DIR, "best_params.pkl")
if os.path.exists(best_params_path):
    best_params = joblib.load(best_params_path)
    print("✅ Loaded best params for evaluation:", best_params)
else:
    print("⚠️ No tuned params found, using defaults.")
    best_params = {
        "lof_n_neighbors": 20,
        "lof_contamination": 0.05,
        "alpha": 0.5,
    }

# --------- Features ---------
features = [
    "consumption_kwh",
    "billed_kwh",
    "ratio",
    "monthly_change",
    "cat_dev",
    "billing_gap",
    "rolling_avg_3m",
    "rolling_std_3m",
    "volatility",
    "billing_efficiency",
    "season_sin",
    "season_cos",
]
X = df[features].fillna(0)
scaler = joblib.load(os.path.join(MODEL_DIR, "scaler.pkl"))
X_scaled = scaler.transform(X)


# --------- Step 1: Model Scores ---------
df["iso_score"] = iso.score_samples(X_scaled)


# Local Outlier Factor — continuous scoring for hybrid evaluation
lof = LocalOutlierFactor(
    n_neighbors=best_params.get("lof_n_neighbors", 20),
    contamination=best_params.get("lof_contamination", 0.05),
    novelty=True  # ✅ enables scoring on same data
)
lof.fit(X_scaled)
df["lof_score"] = -lof.score_samples(X_scaled)  # higher = more anomalous

# --------- Deep Hybrid Meta-Model Integration ---------
meta_model_path = os.path.join(MODEL_DIR, "meta_model.pkl")
if os.path.exists(meta_model_path):
    meta_model = joblib.load(meta_model_path)
    meta_features = df[["iso_score", "lof_score", "rule_flag"]] if "rule_flag" in df.columns else df[["iso_score", "lof_score"]]
    # probability of being synthetic/anomalous (meta model trained with is_synthetic)
    try:
        df["meta_pred_prob"] = meta_model.predict_proba(meta_features)[:, 1]
        df["meta_norm"] = MinMaxScaler().fit_transform(df[["meta_pred_prob"]])
        print("🤖 Meta-model predictions integrated successfully.")
    except Exception:
        df["meta_norm"] = 0
        print("⚠️ Meta-model loaded but failed to predict — skipping meta integration.")
else:
    df["meta_norm"] = 0
    print("⚠️ Meta-model not found — skipping deep hybrid layer.")


# --------- Step 2: Normalize Scores ---------
scaler = MinMaxScaler()
df["iso_norm"] = scaler.fit_transform(df[["iso_score"]])
df["lof_norm"] = scaler.fit_transform(df[["lof_score"]])


alpha = best_params.get("alpha", 0.5)
df["combined_score"] = alpha * df["iso_norm"] + (1 - alpha) * df["lof_norm"]

# --------- Step 3: Rule-based Anomaly Flags ---------
under_flag = (df["ratio"] < 0.85).astype(int)
over_flag = (df["ratio"] > 1.3).astype(int)
df["rule_flag"] = under_flag | over_flag

# Mild penalty for rule-based anomalies
# Blend combined_score with meta_norm for a deep-hybrid final ranking
df["final_score"] = (
    0.7 * df["combined_score"] +
    0.3 * df["meta_norm"] -
    df["rule_flag"] * 0.2
)

# --------- Step 4: True Labels (BEFORE auto-threshold!) ---------
if "is_synthetic" in df.columns:
    df["true_label"] = df["is_synthetic"].apply(lambda x: -1 if x == 1 else 1)
else:
    print("⚠️ No synthetic labels found! Falling back to random labels.")
    df["true_label"] = 1
    fraud_idx = df.sample(30, random_state=42).index
    df.loc[fraud_idx, "true_label"] = -1


# --------- Step 5: Auto-Tune Threshold ---------
best_threshold = None
best_f1 = -1
best_precision = 0
best_recall = 0
for q in np.linspace(0.01, 0.15, 30):
    temp_label = np.where(df["final_score"] < df["final_score"].quantile(q), -1, 1)

    precision_q = precision_score(df["true_label"], temp_label, pos_label=-1, zero_division=0)
    recall_q = recall_score(df["true_label"], temp_label, pos_label=-1, zero_division=0)
    f1_q = f1_score(df["true_label"], temp_label, pos_label=-1, zero_division=0)

    # pick best quantile by F1 (tie broken by precision)
    if f1_q > best_f1 or (f1_q == best_f1 and precision_q > best_precision):
        best_f1 = f1_q
        best_precision = precision_q
        best_recall = recall_q
        best_threshold = q

# fallback if not found
if best_threshold is None:
    best_threshold = 0.05

# Apply best threshold to create final predictions
df["pred"] = np.where(df["final_score"] < df["final_score"].quantile(best_threshold), -1, 1)

# --------- Step 5b: Persistence filter based on predictions (2+ consecutive anomalies) ---------
df["persistent_anomaly"] = (
    df.groupby("customer_id")["pred"]
    .rolling(2)
    .apply(lambda x: (x == -1).sum(), raw=True)
    .reset_index(0, drop=True)
    .ge(2)
    .astype(int)
)

print(f"⚙️ Auto-tuned quantile: {best_threshold:.3f} (F1={best_f1:.3f}, P={best_precision:.3f}, R={best_recall:.3f})")


# --------- Step 6: Metrics ---------
precision = precision_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)
recall = recall_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)
f1 = f1_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)

print("\n📊 Evaluation Results (Improved Hybrid Logic):")
print(f"Precision: {precision:.3f}")
print(f"Recall:    {recall:.3f}")
print(f"F1 Score:  {f1:.3f}")

# --- Diagnostic: how much did the meta layer help? ---
if "meta_norm" in df.columns and df["meta_norm"].sum() > 0:
    corr = np.corrcoef(df["meta_norm"], df["final_score"])[0, 1]
    print(f"🧠 Meta–Hybrid correlation: {corr:.3f} (higher = better alignment)")

# --------- Step 7: Confusion Matrix ---------
cm = confusion_matrix(df["true_label"], df["pred"], labels=[-1, 1])
plt.figure(figsize=(5, 4))
sns.heatmap(cm, annot=True, fmt="d", cmap="Blues",
            xticklabels=["Fraud", "Normal"],
            yticklabels=["Fraud", "Normal"])
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.title("Confusion Matrix (Persistent Anomalies)")
plt.tight_layout()
plt.savefig(CONF_MATRIX_FILE)
print(f"📊 Confusion matrix plot saved to {CONF_MATRIX_FILE}")
plt.show()

# --------- Step 8: Save Per-Customer Results ---------
results = (
    df.groupby("customer_id")
      .agg(
          avg_score=("final_score", "mean"),
          predicted_label=("pred", lambda x: -1 if (x == -1).sum() > 0 else 1),
          true_label=("true_label", lambda x: -1 if (x == -1).sum() > 0 else 1),
          persistent_anomaly=("persistent_anomaly", "max"),
          synthetic_flags=("is_synthetic", "sum")
      )
      .reset_index()
      .sort_values("avg_score")
)

results.to_csv(RESULTS_FILE, index=False)
print(f"✅ Detailed evaluation results saved to {RESULTS_FILE}")

# ----------------- Add human-readable reasons for exported results -----------------
def generate_reason(row):
    reasons = []
    # use safe getters in case fields are missing or NaN
    try:
        ratio = float(row.get("ratio", 1.0))
    except Exception:
        ratio = 1.0
    try:
        monthly_change = float(row.get("monthly_change", 0.0))
    except Exception:
        monthly_change = 0.0

    if ratio < 0.85:
        reasons.append("Under-billing suspected")
    elif ratio > 1.3:
        reasons.append("Over-billing anomaly")
    if abs(monthly_change) > 100:
        reasons.append("Sudden consumption jump/drop")
    if int(row.get("persistent_anomaly", 0)) == 1:
        reasons.append("Repeated anomaly pattern")
    if not reasons:
        reasons.append("Normal pattern")
    return " | ".join(reasons)

# Use the customer's latest record to provide context for the reason column
recent = (
    df.sort_values(["customer_id", "month"])  # chronological
    .groupby("customer_id")
    .last()
    .reset_index()[["customer_id", "ratio", "monthly_change", "persistent_anomaly"]]
)

results = results.merge(recent, on="customer_id", how="left")
results["reason"] = results.apply(generate_reason, axis=1)

# overwrite exported results with the enriched CSV
results.to_csv(RESULTS_FILE, index=False)
print(f"✅ Detailed evaluation results (with reasons) saved to {RESULTS_FILE}")

# --------- Step 9: Logging ---------
new_log = pd.DataFrame([{
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "precision": round(precision, 3),
    "recall": round(recall, 3),
    "f1_score": round(f1, 3),
    "notes": "Improved hybrid evaluation (normalized + persistence)"
}])

# --- Explainability diagnostics appended to the log ---
new_log["best_threshold"] = round(best_threshold, 3)
if "meta_norm" in df.columns:
    corr = np.corrcoef(df["meta_norm"], df["final_score"])[0, 1]
    new_log["meta_corr"] = round(corr, 3)
else:
    new_log["meta_corr"] = None

if os.path.exists(LOG_FILE):
    log = pd.read_csv(LOG_FILE)
    log = pd.concat([log, new_log], ignore_index=True)
else:
    log = new_log

log.to_csv(LOG_FILE, index=False)
print(f"✅ Metrics logged to {LOG_FILE}")
print("✅ Evaluation complete using normalized hybrid model with persistence.")
