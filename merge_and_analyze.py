# merge_and_analyze.py (improved hybrid analysis + persistent anomaly support)

import os
import pandas as pd
import matplotlib.pyplot as plt

# --------- Paths ---------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
REPORTS_DIR = os.path.join(BASE_DIR, "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

TOP50_FILE = os.path.join(DATA_DIR, "top50_suspicious_customers.csv")
TRAIN_FILE = os.path.join(DATA_DIR, "training_with_synthetics.csv")
EVAL_RESULTS_FILE = os.path.join(DATA_DIR, "evaluation_results.csv")

OUTPUT_FILE = os.path.join(DATA_DIR, "merged_analysis.csv")
TRUE_FRAUDS_FILE = os.path.join(DATA_DIR, "true_frauds.csv")
SUMMARY_PLOT = os.path.join(REPORTS_DIR, "fraud_summary.png")

# --------- Load Data ---------
print("🔍 Loading input data...")
train = pd.read_csv(TRAIN_FILE, parse_dates=["month"])
top50 = pd.read_csv(TOP50_FILE)

# --------- True Fraud Labels (synthetic ground truth) ---------
fraud_labels = (
    train.groupby("customer_id")["is_synthetic"]
    .max()
    .reset_index()
    .rename(columns={"is_synthetic": "true_fraud"})
)

# --------- Merge with top 50 suspicious list ---------
merged = top50.merge(fraud_labels, on="customer_id", how="left")

# Compute persistent anomaly rate per customer (if available)
if "persistent_anomaly" in train.columns:
    persistence = (
        train.groupby("customer_id")["persistent_anomaly"]
        .mean()
        .reset_index()
        .rename(columns={"persistent_anomaly": "persistence_rate"})
    )
    merged = merged.merge(persistence, on="customer_id", how="left")

merged["fraud_status"] = merged["true_fraud"].apply(
    lambda x: "True Fraud" if x == 1 else "False Alarm"
)

# --------- Enhanced Merge with Evaluation Metrics ---------
if os.path.exists(EVAL_RESULTS_FILE):
    eval_results = pd.read_csv(EVAL_RESULTS_FILE)
    merged = merged.merge(
        eval_results[["customer_id", "predicted_label", "true_label", "avg_score"]],
        on="customer_id",
        how="left"
    )

    label_map = {-1: "Fraud", 1: "Normal"}
    merged["predicted_label"] = merged["predicted_label"].map(label_map)
    merged["true_label"] = merged["true_label"].map(label_map)

    def classify_row(row):
        if row["true_label"] == "Fraud" and row["predicted_label"] == "Fraud":
            return "True Positive (Caught Fraud)"
        elif row["true_label"] == "Normal" and row["predicted_label"] == "Fraud":
            return "False Positive (False Alarm)"
        elif row["true_label"] == "Fraud" and row["predicted_label"] == "Normal":
            return "False Negative (Missed Fraud)"
        else:
            return "True Negative (Correct Normal)"

    merged["detection_outcome"] = merged.apply(classify_row, axis=1)
else:
    print("⚠️ Evaluation results not found. Proceeding without evaluation merge.")
    merged["detection_outcome"] = merged["fraud_status"]

# --------- Fraud Precision & Recall Summary ---------
if "detection_outcome" in merged.columns:
    total_frauds = (merged["detection_outcome"] == "True Positive (Caught Fraud)").sum()
    total_predicted = (merged["predicted_label"] == "Fraud").sum() if "predicted_label" in merged else 0
    total_actual = (merged["true_label"] == "Fraud").sum() if "true_label" in merged else 0

    precision = (total_frauds / total_predicted) if total_predicted else 0
    recall = (total_frauds / total_actual) if total_actual else 0
    merged.attrs["precision"] = precision
    merged.attrs["recall"] = recall

    print(f"\n🎯 Fraud Precision: {precision:.2%}")
    print(f"🎯 Fraud Recall:    {recall:.2%}")

# --------- Save Reports ---------
merged.to_csv(OUTPUT_FILE, index=False)
print(f"✅ Merged report saved to {OUTPUT_FILE}")

true_frauds = merged[merged["fraud_status"] == "True Fraud"]
true_frauds.to_csv(TRUE_FRAUDS_FILE, index=False)
print(f"✅ True fraud customers saved to {TRUE_FRAUDS_FILE}")

# --------- Summary Table ---------
summary = (
    merged["detection_outcome"].value_counts()
    if "detection_outcome" in merged.columns
    else merged["fraud_status"].value_counts()
)

print("\n📊 Summary Breakdown:")
print(summary)

# --------- Visualization ---------
plt.figure(figsize=(7, 5))
summary.plot(kind="bar", color=["green", "red", "orange", "blue"])
plt.title("Fraud Detection Outcomes (Hybrid Model)")
plt.xlabel("Outcome")
plt.ylabel("Number of Customers")
plt.xticks(rotation=25)
plt.tight_layout()

plt.savefig(SUMMARY_PLOT)
print(f"📈 Fraud summary plot saved to {SUMMARY_PLOT}")
plt.show()

print("\n✅ merge_and_analyze.py completed successfully.")
