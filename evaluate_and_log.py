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
features = ["consumption_kwh", "billed_kwh", "ratio", "monthly_change", "cat_dev", "billing_gap"]
X = df[features].fillna(0)

# --------- Step 1: Model Scores ---------
df["iso_score"] = iso.decision_function(X)

lof = LocalOutlierFactor(
    n_neighbors=best_params.get("lof_n_neighbors", 20),
    contamination=best_params.get("lof_contamination", 0.05),
)
df["lof_pred"] = lof.fit_predict(X)

# --------- Step 2: Normalize Scores ---------
scaler = MinMaxScaler()
df["iso_norm"] = scaler.fit_transform(df[["iso_score"]])
df["lof_norm"] = scaler.fit_transform(np.abs(df[["lof_pred"]]))  # LOF outputs -1/1 → abs makes it consistent

alpha = best_params.get("alpha", 0.5)
df["combined_score"] = alpha * df["iso_norm"] + (1 - alpha) * df["lof_norm"]

# --------- Step 3: Rule-based Anomaly Flags ---------
under_flag = (df["ratio"] < 0.85).astype(int)
over_flag = (df["ratio"] > 1.3).astype(int)
df["rule_flag"] = under_flag | over_flag

# Mild penalty for rule-based anomalies
df["final_score"] = df["combined_score"] - df["rule_flag"] * 0.2

# --------- Step 4: Label Anomalies ---------
threshold = df["final_score"].quantile(0.05)
df["anomaly_label"] = (df["final_score"] < threshold).astype(int)

# Persistence check: anomaly for 2+ consecutive months
df["persistent_anomaly"] = (
    df.groupby("customer_id")["anomaly_label"]
    .rolling(2)
    .sum()
    .reset_index(0, drop=True)
    .ge(2)
    .astype(int)
)

# --------- Step 5: True Labels ---------
if "is_synthetic" in df.columns:
    df["true_label"] = df["is_synthetic"].apply(lambda x: -1 if x == 1 else 1)
else:
    print("⚠️ No synthetic labels found! Falling back to random labels.")
    df["true_label"] = 1
    fraud_idx = df.sample(30, random_state=42).index
    df.loc[fraud_idx, "true_label"] = -1

# Use persistent anomalies as final prediction
df["pred"] = df["persistent_anomaly"].apply(lambda x: -1 if x == 1 else 1)

# --------- Step 6: Metrics ---------
precision = precision_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)
recall = recall_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)
f1 = f1_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)

print("\n📊 Evaluation Results (Improved Hybrid Logic):")
print(f"Precision: {precision:.3f}")
print(f"Recall:    {recall:.3f}")
print(f"F1 Score:  {f1:.3f}")

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

# --------- Step 9: Logging ---------
new_log = pd.DataFrame([{
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "precision": round(precision, 3),
    "recall": round(recall, 3),
    "f1_score": round(f1, 3),
    "notes": "Improved hybrid evaluation (normalized + persistence)"
}])

if os.path.exists(LOG_FILE):
    log = pd.read_csv(LOG_FILE)
    log = pd.concat([log, new_log], ignore_index=True)
else:
    log = new_log

log.to_csv(LOG_FILE, index=False)
print(f"✅ Metrics logged to {LOG_FILE}")
print("✅ Evaluation complete using normalized hybrid model with persistence.")
