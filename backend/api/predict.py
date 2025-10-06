# backend/api/predict.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import pandas as pd
import joblib
import os
import numpy as np

router = APIRouter()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(os.path.dirname(BASE_DIR), "models")

# Safe model/scaler loading (no crash on import)
model_path = os.path.join(MODEL_DIR, "anomaly_model.pkl")
scaler_path = os.path.join(MODEL_DIR, "scaler.pkl")

model = joblib.load(model_path) if os.path.exists(model_path) else None
scaler = joblib.load(scaler_path) if os.path.exists(scaler_path) else None

FEATURES = ["consumption_kwh", "billed_kwh", "ratio", "monthly_change", "cat_dev", "billing_gap"]

class Record(BaseModel):
    consumption_kwh: float
    billed_kwh: float
    ratio: float
    monthly_change: float
    cat_dev: float
    billing_gap: float

class PredictRequest(BaseModel):
    records: list[Record]

@router.post("/predict")
def predict(request: PredictRequest):
    if model is None or scaler is None:
        raise HTTPException(
            status_code=500,
            detail="Model or scaler not available. Please run training (train_model.py) first."
        )

    try:
        df = pd.DataFrame([r.dict() for r in request.records])
        X_scaled = scaler.transform(df[FEATURES])
        scores = model.score_samples(X_scaled)

        # Label using 5th percentile of scores (same convention as training)
        threshold = np.quantile(scores, 0.05)
        labels = np.where(scores < threshold, -1, 1)

        results = []
        for s, l in zip(scores, labels):
            results.append({
                "score": float(s),
                "label": int(l),
                "confidence_score": round(abs(s) * 100, 2),
                "reason": "⚠️ Anomalous pattern detected" if l == -1 else "✅ Stable consumption pattern"
            })

        return {"predictions": results}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
