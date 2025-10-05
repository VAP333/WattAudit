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

# ---------- CONFIG & PATHS ----------
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
MODEL_DIR = os.path.join(BASE_DIR, "..", "models")

MODEL_PATH = os.path.join(MODEL_DIR, "anomaly_model.pkl")
LOCAL_DATA_PATH = os.path.join(DATA_DIR, "merged_data.csv")  # ✅ unified dataset
NEON_CONN = os.getenv("NEON_CONN")

features = ["consumption_kwh", "billed_kwh", "ratio", "monthly_change", "cat_dev", "billing_gap"]

# ---------- INIT ----------
app = FastAPI(title="⚡ WattAudit++ Explainable AI API", version="3.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- LOAD MODEL + LOCAL DATA ----------
try:
    model = joblib.load(MODEL_PATH)
    print("✅ Model loaded successfully.")
except Exception:
    model = None
    print("⚠️ Model missing — please run train_model.py first.")

try:
    df_local = pd.read_csv(LOCAL_DATA_PATH, parse_dates=["month"])
    print(f"✅ Local dataset loaded: {len(df_local)} rows.")
except Exception:
    df_local = pd.DataFrame()
    print("⚠️ Local dataset missing — please upload or generate one.")


# ---------- HELPERS ----------
def _rescaled_confidence(score: float) -> float:
    """Better confidence mapping for human interpretability."""
    scaled_score = max(min(score, 0.3), -0.3)  # Clamp extremes
    return round((1 - ((scaled_score + 0.3) / 0.6)) * 100, 2)


def generate_reason(row):
    """Explain why a customer's record looks anomalous or normal (aligned with AI label)."""
    try:
        ratio = float(row.get("ratio", 1.0))
        change = float(row.get("monthly_change", 0.0))
        cons = float(row.get("consumption_kwh", 0.0))
        score = float(row.get("anomaly_score", row.get("avg_anomaly_score", 0.0)))
        label = int(row.get("anomaly_label", 1))

        # 🔴 Only consider anomaly if label says so (ignore mild negative averages)
        if label == -1:
            if ratio < 0.85:
                return "⚠️ Underbilling anomaly — billed much less than consumption."
            elif ratio > 1.3:
                return "⚠️ Overbilling anomaly — charged higher than usage."
            elif abs(change) > cons * 0.4:
                direction = "rise" if change > 0 else "drop"
                return f"⚡ Sudden {direction} — unusual consumption shift."
            else:
                return "⚠️ AI detected anomaly — irregular usage pattern detected."

        # 🟢 Normal cases (only reached if AI says 'normal')
        if 0.9 <= ratio <= 1.2 and abs(change) <= cons * 0.1:
            return "✅ Stable usage — consistent with historical trends."
        elif abs(change) > cons * 0.3:
            direction = "increase" if change > 0 else "decrease"
            return f"ℹ️ Noticeable {direction} in usage trend."
        else:
            return "ℹ️ Mild variation — within expected range."

    except Exception:
        return "❓ Insufficient data for reasoning."


def generate_summary(cust_id: str, cust_data: pd.DataFrame):
    """Generate multilingual human-readable summary."""
    avg_consumption = float(cust_data["consumption_kwh"].mean())
    recent = cust_data.sort_values("month").tail(1)
    cons_recent = float(recent["consumption_kwh"].iloc[0])
    bill_recent = float(recent["billed_kwh"].iloc[0])
    ratio = bill_recent / (cons_recent + 1)
    deviation = cons_recent - avg_consumption
    percent_change = (deviation / avg_consumption) * 100 if avg_consumption else 0.0

    # --- Narrative generation ---
    if ratio < 0.85:
        summary_en = (
            f"Customer {cust_id} seems **underbilled** — billed {bill_recent:.1f} for {cons_recent:.1f} kWh consumed. "
            "Possible meter or reading issue. Recommended: verify meter logs."
        )
    elif ratio > 1.3:
        summary_en = (
            f"Customer {cust_id} appears **overbilled** — charged {bill_recent:.1f} units for {cons_recent:.1f} kWh. "
            "Review tariff or billing system integrity."
        )
    elif percent_change > 50:
        summary_en = (
            f"Customer {cust_id} shows a **sharp consumption increase** — {percent_change:.0f}% higher than average. "
            "May indicate new equipment or seasonal load."
        )
    elif percent_change < -50:
        summary_en = (
            f"Customer {cust_id} shows a **sharp drop** — {abs(percent_change):.0f}% below their average. "
            "Possible reduced usage or meter malfunction."
        )
    else:
        summary_en = (
            f"Customer {cust_id}'s consumption ({cons_recent:.1f} kWh) aligns with their typical average ({avg_consumption:.1f} kWh). "
            "No significant anomalies detected."
        )

    summary_en += " — Insight generated by WattAudit++ Hybrid Explainable AI."

    try:
        summary_hi = GoogleTranslator(source="en", target="hi").translate(summary_en)
        summary_mr = GoogleTranslator(source="en", target="mr").translate(summary_en)
    except Exception:
        summary_hi = summary_mr = "⚠️ Translation unavailable."

    return summary_en, summary_hi, summary_mr


# ---------- ROUTES ----------
@app.get("/")
def root():
    return {"message": "⚡ WattAudit++ Hybrid AI Backend is live (Neon + Local fallback)."}


@app.post("/upload_dataset")
def upload_dataset(file: UploadFile = File(...)):
    """Upload or replace local dataset."""
    try:
        df = pd.read_csv(file.file)
        required = {"customer_id", "month", "consumption_kwh", "billed_kwh", "consumer_category"}
        missing = required - set(df.columns)
        if missing:
            return {"error": f"Missing columns: {sorted(list(missing))}"}
        df["month"] = pd.to_datetime(df["month"], errors="coerce")
        df.to_csv(LOCAL_DATA_PATH, index=False)
        return {"message": "✅ Dataset uploaded successfully!", "rows": len(df)}
    except Exception as e:
        return {"error": f"Upload failed: {e}"}


@app.get("/get_data")
def get_data(limit: int = 100):
    """Return recent data for live feed."""
    try:
        if NEON_CONN:
            conn = psycopg2.connect(NEON_CONN)
            query = f"SELECT * FROM billing_data ORDER BY month DESC LIMIT {limit};"
            df = pd.read_sql(query, conn)
            conn.close()
        else:
            df = df_local.copy()
        df["month"] = pd.to_datetime(df["month"]).dt.strftime("%Y-%m-%d")
        return df.to_dict(orient="records")
    except Exception:
        if not df_local.empty:
            sample = df_local.sort_values("month", ascending=False).head(limit)
            sample["month"] = pd.to_datetime(sample["month"]).dt.strftime("%Y-%m-%d")
            return sample.to_dict(orient="records")
        return []


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
        df["anomaly_score"] = model.decision_function(df[features].fillna(0))
        df["anomaly_label"] = model.predict(df[features].fillna(0))
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
        df["anomaly_score"] = model.decision_function(df[features].fillna(0))
        df["anomaly_label"] = model.predict(df[features].fillna(0))
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

        score = float(model.decision_function(sample[features].fillna(0))[0])
        label = int(model.predict(sample[features].fillna(0))[0])
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
