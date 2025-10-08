# ⚡ WattAudit++ Explainable AI Backend — Hybrid Live + Local Version (Frontend Synced)

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import joblib
import os
import psycopg2
from deep_translator import GoogleTranslator
from dotenv import load_dotenv
from backend.api import customers, anomalies, predict, insights

# ---------- CONFIG & PATHS ----------
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
MODEL_DIR = os.path.join(BASE_DIR, "..", "models")

MODEL_PATH = os.path.join(MODEL_DIR, "anomaly_model.pkl")
SCALER_PATH = os.path.join(MODEL_DIR, "scaler.pkl")
LOCAL_DATA_PATH = os.path.join(DATA_DIR, "merged_data.csv")  # ✅ unified dataset
NEON_CONN = os.getenv("NEON_CONN")

FEATURES = [
    "consumption_kwh",
    "billed_kwh",
    "ratio",
    "monthly_change",
    "cat_dev",
    "billing_gap",
]

# ---------- INIT ----------
app = FastAPI(title="⚡ WattAudit++ Explainable AI API", version="3.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers from the `api` package.
# Note: `customers.router` already defines the `/api/customers` prefix,
# so we include it as-is. The other routers are mounted under `/api`
# to avoid colliding with existing top-level routes in this file.
app.include_router(customers.router)
app.include_router(anomalies.router, prefix="/api")
app.include_router(predict.router, prefix="/api")
app.include_router(insights.router, prefix="/api")

# ---------- LOAD MODEL + SCALER + LOCAL DATA ----------
try:
    model = joblib.load(MODEL_PATH)
    print("✅ Model loaded successfully.")
except Exception:
    model = None
    print("⚠️ Model missing — please run train_model.py first.")

try:
    scaler = joblib.load(SCALER_PATH)
    print("✅ Scaler loaded successfully.")
except Exception:
    scaler = None
    print("⚠️ Scaler missing — predictions may be inconsistent.")

try:
    df_local = pd.read_csv(LOCAL_DATA_PATH, parse_dates=["month"])
    print(f"✅ Local dataset loaded: {len(df_local)} rows.")
except Exception:
    df_local = pd.DataFrame()
    print("⚠️ Local dataset missing — please upload or generate one.")


# ---------- HELPERS ----------
def _rescaled_confidence(score: float) -> float:
    scaled_score = max(min(score, 0.3), -0.3)  # Clamp extremes
    return round((1 - ((scaled_score + 0.3) / 0.6)) * 100, 2)

# (generate_reason and generate_summary remain unchanged)
# ---------- AI Reasoning Helpers ----------
def generate_reason(record):
    """
    Generate a human-readable reason for anomaly / normal classification.
    Works for both aggregated and single-record inputs.
    """
    # Support both dict-like and pandas Series inputs
    try:
        ratio = record.get("ratio", 1.0)
        monthly_change = record.get("monthly_change", 0.0)
        anomaly_score = record.get("anomaly_score", 0.0)
        anomaly_label = record.get("anomaly_label", 1)
    except Exception:
        # fallback for unexpected input types
        ratio = float(record["ratio"]) if "ratio" in record else 1.0
        monthly_change = float(record["monthly_change"]) if "monthly_change" in record else 0.0
        anomaly_score = float(record.get("anomaly_score", 0.0))
        anomaly_label = int(record.get("anomaly_label", 1))

    reasons = []

    # Billing anomalies
    if ratio < 0.85:
        reasons.append("⚠️ Under-billing detected")
    elif ratio > 1.3:
        reasons.append("⚠️ Over-billing detected")

    # Sudden consumption changes
    if abs(monthly_change) > 100:  # heuristic threshold
        reasons.append("⚡ Sudden change in consumption pattern")

    # Model output
    if anomaly_label == -1:
        reasons.append(f"🤖 AI flagged this as anomalous (score={anomaly_score:.3f})")
    else:
        reasons.append(f"✅ Stable consumption pattern (score={anomaly_score:.3f})")

    return " | ".join(reasons)


def generate_summary(cust_id: str, df: pd.DataFrame):
    """
    Generate summary in English, Hindi, and Marathi using deep_translator.
    """
    # Simple English base summary
    anomaly_count = int((df["anomaly_label"] == -1).sum())
    total_months = len(df)
    score_avg = df["anomaly_score"].mean()

    if anomaly_count == 0:
        base_summary = (
            f"Customer {cust_id} shows a stable consumption pattern with no anomalies "
            f"detected over {total_months} months. Average anomaly score: {score_avg:.3f}."
        )
    else:
        base_summary = (
            f"Customer {cust_id} shows {anomaly_count} anomalies out of {total_months} months. "
            f"Average anomaly score: {score_avg:.3f}. Potential billing or usage irregularities detected."
        )

    try:
        summary_hi = GoogleTranslator(source="en", target="hi").translate(base_summary)
    except Exception:
        summary_hi = "⚠️ Translation unavailable (Hindi)."

    try:
        summary_mr = GoogleTranslator(source="en", target="mr").translate(base_summary)
    except Exception:
        summary_mr = "⚠️ Translation unavailable (Marathi)."

    return base_summary, summary_hi, summary_mr


# ---------- ROUTES ----------
@app.get("/")
def root():
    return {"message": "⚡ WattAudit++ Hybrid AI Backend is live (Neon + Local fallback)."}


@app.get("/customers")
def get_customers(limit: int = 500):
    """Return all customers with anomaly metrics (ranked)."""
    try:
        if NEON_CONN:
            conn = psycopg2.connect(NEON_CONN)
            query = f"SELECT * FROM billing_data ORDER BY month DESC LIMIT {limit};"
            df = pd.read_sql(query, conn)
            conn.close()
        else:
            df = df_local.copy()
    except Exception:
        df = df_local.copy()

    if df.empty:
        return {"top_customers": [], "total_alerts": 0}

    df = df.sort_values(["customer_id", "month"])
    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df.groupby("customer_id")["consumption_kwh"].diff().fillna(0)
    cat_avg = df.groupby("consumer_category")["consumption_kwh"].transform("mean")
    df["cat_dev"] = df["consumption_kwh"] - cat_avg
    df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]

    if model is not None:
        X = df[FEATURES].fillna(0)
        if scaler is not None:
            X = scaler.transform(X)
        df["anomaly_score"] = model.score_samples(X)
        df["anomaly_label"] = model.predict(X)
    else:
        df["anomaly_score"], df["anomaly_label"] = 0.0, 1

    agg = (
        df.groupby(["customer_id", "consumer_category"])
        .agg(
            avg_anomaly_score=("anomaly_score", "mean"),
            ratio=("ratio", "mean"),
            monthly_change=("monthly_change", "mean"),
            consumption_kwh=("consumption_kwh", "mean"),
            anomaly_label=("anomaly_label", "min"),  # ✅ preserve anomaly flag
        )
        .reset_index()
    )

    agg["reason"] = agg.apply(generate_reason, axis=1)
    agg = agg.sort_values("avg_anomaly_score").head(50)
    total_alerts = int((df["anomaly_label"] == -1).sum())

    return {"top_customers": agg.to_dict(orient="records"), "total_alerts": total_alerts}


@app.get("/customer/{cust_id}")
def get_customer(cust_id: str):
    """Detailed customer report with multilingual summary."""
    try:
        if NEON_CONN:
            conn = psycopg2.connect(NEON_CONN)
            query = "SELECT * FROM billing_data WHERE customer_id = %s ORDER BY month;"
            df = pd.read_sql(query, conn, params=[cust_id])
            conn.close()
        else:
            df = df_local[df_local["customer_id"] == cust_id].copy()
    except Exception:
        df = df_local[df_local["customer_id"] == cust_id].copy()

    if df.empty:
        return {"error": "Customer not found."}

    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df["consumption_kwh"].diff().fillna(0)
    df["cat_dev"] = df["consumption_kwh"] - df["consumption_kwh"].mean()
    df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]

    if model is not None:
        X = df[FEATURES].fillna(0)
        if scaler is not None:
            X = scaler.transform(X)
        df["anomaly_score"] = model.score_samples(X)
        df["anomaly_label"] = model.predict(X)
    else:
        df["anomaly_score"], df["anomaly_label"] = 0.0, 1

    summary_en, summary_hi, summary_mr = generate_summary(cust_id, df)
    latest = df.sort_values("month").tail(1).iloc[0]
    reason = generate_reason(latest)

    score = float(latest.get("anomaly_score", 0))
    label = int(latest.get("anomaly_label", 1))
    confidence = _rescaled_confidence(score)

    df["month"] = pd.to_datetime(df["month"]).dt.strftime("%Y-%m-%d")
    return {
        "customer_id": cust_id,
        "records": df.to_dict(orient="records"),
        "summary": {"english": summary_en, "hindi": summary_hi, "marathi": summary_mr},
        "ai_analysis": {
            "anomaly_score": score,
            "anomaly_label": label,
            "confidence_score": confidence,
            "reason": reason,
        },
    }


# ---------- SINGLE RECORD PREDICTION ----------
class PredictRequest(BaseModel):
    consumption_kwh: float
    billed_kwh: float
    category: str = "Residential"


@app.post("/predict")
def predict(req: PredictRequest):
    """AI prediction for a single input."""
    try:
        ratio = req.billed_kwh / (req.consumption_kwh + 1)
        sample = pd.DataFrame([{
            "consumption_kwh": req.consumption_kwh,
            "billed_kwh": req.billed_kwh,
            "ratio": ratio,
            "monthly_change": 0.0,
            "cat_dev": 0.0,
            "billing_gap": req.consumption_kwh - req.billed_kwh,
        }])

        if model is None:
            return {"error": "Model not available"}

        X = sample[FEATURES].fillna(0)
        if scaler is not None:
            X = scaler.transform(X)

        score = float(model.score_samples(X)[0])
        label = int(model.predict(X)[0])
        confidence = _rescaled_confidence(score)
        reason = generate_reason({
            "ratio": ratio,
            "monthly_change": 0.0,
            "consumption_kwh": req.consumption_kwh,
            "anomaly_score": score,
            "anomaly_label": label
        })

        return {
            "score": score,
            "label": label,
            "confidence_score": confidence,
            "reason": reason,
        }
    except Exception as e:
        return {"error": f"Prediction failed: {e}"}
