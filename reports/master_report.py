# master_report.py
"""
Combine all reports into one master file:
- metrics_log.csv (technical metrics)
- evaluation_results.csv (per-customer outcomes)
- merged_analysis.csv (fraud detection summary)
"""

import os
import pandas as pd

# -------- Paths --------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
REPORTS_DIR = os.path.join(BASE_DIR, "reports")
os.makedirs(REPORTS_DIR, exist_ok=True)

METRICS_LOG = os.path.join(BASE_DIR, "metrics_log.csv")
EVAL_RESULTS = os.path.join(DATA_DIR, "evaluation_results.csv")
MERGED_ANALYSIS = os.path.join(DATA_DIR, "merged_analysis.csv")

MASTER_REPORT = os.path.join(REPORTS_DIR, "master_report.csv")

# -------- Load Data --------
dfs = []

# Technical metrics
if os.path.exists(METRICS_LOG):
    metrics = pd.read_csv(METRICS_LOG)
    metrics["report_type"] = "metrics_log"
    dfs.append(metrics)

# Evaluation results (per customer)
if os.path.exists(EVAL_RESULTS):
    eval_res = pd.read_csv(EVAL_RESULTS)
    eval_summary = eval_res.groupby("predicted_label").size().reset_index(name="count")
    eval_summary["report_type"] = "evaluation_results_summary"
    dfs.append(eval_summary)

# Business fraud analysis (top50 merge)
if os.path.exists(MERGED_ANALYSIS):
    merged = pd.read_csv(MERGED_ANALYSIS)
    if "detection_outcome" in merged.columns:
        summary = merged["detection_outcome"].value_counts().reset_index()
        summary.columns = ["outcome", "count"]
        summary["report_type"] = "merged_analysis"
        dfs.append(summary)
    else:
        summary = merged["fraud_status"].value_counts().reset_index()
        summary.columns = ["outcome", "count"]
        summary["report_type"] = "merged_analysis"
        dfs.append(summary)

# -------- Combine Reports --------
if dfs:
    master = pd.concat(dfs, ignore_index=True)
    master.to_csv(MASTER_REPORT, index=False)
    print(f"✅ Master report saved to {MASTER_REPORT}")
else:
    print("⚠️ No reports found to merge.")
