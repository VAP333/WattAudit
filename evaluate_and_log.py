# evaluate_and_log.py (with tuned parameters)

import os
import pandas as pd
import numpy as np
import joblib
from sklearn.neighbors import LocalOutlierFactor
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
        "rule_cutoff": 0.85,
        "alpha": 0.5,
    }

# --------- Features ---------
features = ["consumption_kwh", "billed_kwh", "ratio", "monthly_change", "cat_dev", "billing_gap"]
X = df[features].fillna(0)

# --------- Hybrid Predictions ---------
# Isolation Forest
df["iso_value"] = iso.decision_function(X)

# Local Outlier Factor (refits here on the full data)
lof = LocalOutlierFactor(
    n_neighbors=best_params.get("lof_n_neighbors", 20),
    contamination=best_params.get("lof_contamination", 0.05),
)
df["lof_score"] = lof.fit_predict(X)

# Rule-based detection
df["rule_flag"] = (df["ratio"] < best_params.get("rule_cutoff", 0.85)).astype(int)

# Final anomaly score
alpha = best_params.get("alpha", 0.5)
df["final_score"] = alpha * df["iso_value"] + (1 - alpha) * df["lof_score"] - df["rule_flag"] * 2

# Label anomalies = bottom X% of scores (default = 5%)
threshold = np.percentile(df["final_score"], 5)
df["pred"] = np.where(df["final_score"] <= threshold, -1, 1)

# --------- True Labels ---------
if "is_synthetic" in df.columns:
    df["true_label"] = df["is_synthetic"].apply(lambda x: -1 if x == 1 else 1)
else:
    print("⚠️ No synthetic labels found! Falling back to random labels.")
    df["true_label"] = 1
    fraud_idx = df.sample(30, random_state=42).index
    df.loc[fraud_idx, "true_label"] = -1

# --------- Metrics ---------
precision = precision_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)
recall = recall_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)
f1 = f1_score(df["true_label"], df["pred"], pos_label=-1, zero_division=0)

print("\n📊 Evaluation Results:")
print(f"Precision: {precision:.3f}")
print(f"Recall:    {recall:.3f}")
print(f"F1 Score:  {f1:.3f}")

# --------- Confusion Matrix ---------
cm = confusion_matrix(df["true_label"], df["pred"], labels=[-1, 1])
plt.figure(figsize=(5, 4))
sns.heatmap(cm, annot=True, fmt="d", cmap="Blues", 
            xticklabels=["Fraud", "Normal"], 
            yticklabels=["Fraud", "Normal"])
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.title("Confusion Matrix")
plt.tight_layout()

plt.savefig(CONF_MATRIX_FILE)
print(f"📊 Confusion matrix plot saved to {CONF_MATRIX_FILE}")
plt.show()

# --------- Save Predictions per Customer ---------
results = (
    df.groupby("customer_id")
      .agg(
          avg_score=("final_score", "mean"),
          predicted_label=("pred", lambda x: -1 if (x == -1).sum() > 0 else 1),
          true_label=("true_label", lambda x: -1 if (x == -1).sum() > 0 else 1),
          synthetic_flags=("is_synthetic", "sum")
      )
      .reset_index()
      .sort_values("avg_score")
)

results.to_csv(RESULTS_FILE, index=False)
print(f"✅ Detailed evaluation results saved to {RESULTS_FILE}")

# --------- Logging ---------
new_log = pd.DataFrame([{
    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "precision": round(precision, 3),
    "recall": round(recall, 3),
    "f1_score": round(f1, 3),
    "notes": "Hybrid evaluation with tuned params"
}])

if os.path.exists(LOG_FILE):
    log = pd.read_csv(LOG_FILE)
    log = pd.concat([log, new_log], ignore_index=True)
else:
    log = new_log

log.to_csv(LOG_FILE, index=False)
print(f"✅ Metrics logged to {LOG_FILE}")
