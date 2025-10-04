# merge_and_analyze.py (with tuned predictions integration)

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
train = pd.read_csv(TRAIN_FILE, parse_dates=["month"])
top50 = pd.read_csv(TOP50_FILE)

# True fraud labels (synthetic injection ground truth)
fraud_labels = (
    train.groupby("customer_id")["is_synthetic"]
    .max()
    .reset_index()
    .rename(columns={"is_synthetic": "true_fraud"})
)

# Merge with top50 suspicious
merged = top50.merge(fraud_labels, on="customer_id", how="left")
merged["fraud_status"] = merged["true_fraud"].apply(
    lambda x: "True Fraud" if x == 1 else "False Alarm"
)

# --------- Enhanced: If evaluation results exist, merge them ---------
if os.path.exists(EVAL_RESULTS_FILE):
    eval_results = pd.read_csv(EVAL_RESULTS_FILE)
    merged = merged.merge(
        eval_results[["customer_id", "predicted_label", "true_label"]],
        on="customer_id",
        how="left"
    )

    # Map labels
    label_map = {-1: "Fraud", 1: "Normal"}
    merged["predicted_label"] = merged["predicted_label"].map(label_map)
    merged["true_label"] = merged["true_label"].map(label_map)

    # Compute classification outcome
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

# --------- Save Reports ---------
merged.to_csv(OUTPUT_FILE, index=False)
print(f"✅ Merged report saved to {OUTPUT_FILE}")

true_frauds = merged[merged["fraud_status"] == "True Fraud"]
true_frauds.to_csv(TRUE_FRAUDS_FILE, index=False)
print(f"✅ True fraud customers saved to {TRUE_FRAUDS_FILE}")

# --------- Summary ---------
if "detection_outcome" in merged.columns:
    summary = merged["detection_outcome"].value_counts()
else:
    summary = merged["fraud_status"].value_counts()

print("📊 Summary:")
print(summary)

# --------- Visualization ---------
plt.figure(figsize=(7, 5))
summary.plot(kind="bar", color=["green", "red", "orange", "blue"])
plt.title("Fraud Detection Outcomes")
plt.xlabel("Outcome")
plt.ylabel("Number of Customers")
plt.xticks(rotation=25)
plt.tight_layout()

plt.savefig(SUMMARY_PLOT)
print(f"📊 Fraud summary plot saved to {SUMMARY_PLOT}")
plt.show()
