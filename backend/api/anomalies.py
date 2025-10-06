# backend/api/anomalies.py
from fastapi import APIRouter, HTTPException
import pandas as pd
import os

router = APIRouter()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(BASE_DIR), "data")
REPORTS_DIR = os.path.join(os.path.dirname(BASE_DIR), "reports")

LOG_FILE = os.path.join(os.path.dirname(BASE_DIR), "metrics_log.csv")
RESULTS_FILE = os.path.join(DATA_DIR, "evaluation_results.csv")


@router.get("/anomalies/metrics")
def get_latest_metrics():
    """Return the latest precision, recall, f1 from metrics_log.csv"""
    if not os.path.exists(LOG_FILE):
        raise HTTPException(status_code=404, detail="Metrics log not found")

    df = pd.read_csv(LOG_FILE)
    latest = df.iloc[-1].to_dict()
    return latest


@router.get("/anomalies/results")
def get_evaluation_results():
    """Return the full evaluation_results.csv"""
    if not os.path.exists(RESULTS_FILE):
        raise HTTPException(status_code=404, detail="Evaluation results not found")

    df = pd.read_csv(RESULTS_FILE)
    return df.to_dict(orient="records")
