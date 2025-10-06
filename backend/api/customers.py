from fastapi import APIRouter
import pandas as pd
import os
import joblib
import psycopg2
from dotenv import load_dotenv

router = APIRouter(prefix="/api/customers", tags=["Customers"])

# Load config & data
load_dotenv()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
MODEL_DIR = os.path.join(BASE_DIR, "..", "models")
LOCAL_DATA_PATH = os.path.join(DATA_DIR, "merged_data.csv")

NEON_CONN = os.getenv("NEON_CONN")

try:
    df_local = pd.read_csv(LOCAL_DATA_PATH, parse_dates=["month"])
except Exception:
    df_local = pd.DataFrame()

try:
    model = joblib.load(os.path.join(MODEL_DIR, "anomaly_model.pkl"))
    scaler = joblib.load(os.path.join(MODEL_DIR, "scaler.pkl"))
except Exception:
    model = None
    scaler = None


@router.get("/")
def get_customers(limit: int = 50):
    """Return top suspicious customers (from Neon or local fallback)."""
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
        return {"customers": [], "total": 0}

    # Compute anomaly metrics if model is loaded
    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df.groupby("customer_id")["consumption_kwh"].diff().fillna(0)
    if model is not None:
        X = df[["consumption_kwh", "billed_kwh", "ratio", "monthly_change"]].fillna(0)
        if scaler is not None:
            X = scaler.transform(X)
        df["anomaly_score"] = model.score_samples(X)
    else:
        df["anomaly_score"] = 0

    top = (
        df.groupby("customer_id")["anomaly_score"]
        .mean()
        .sort_values()
        .head(limit)
        .reset_index()
    )
    return {"customers": top.to_dict(orient="records"), "total": len(top)}


@router.get("/{customer_id}")
def get_customer_detail(customer_id: str):
    """Return full anomaly history for a single customer."""
    if NEON_CONN:
        try:
            conn = psycopg2.connect(NEON_CONN)
            query = "SELECT * FROM billing_data WHERE customer_id = %s ORDER BY month;"
            df = pd.read_sql(query, conn, params=[customer_id])
            conn.close()
        except Exception:
            df = df_local[df_local["customer_id"] == customer_id].copy()
    else:
        df = df_local[df_local["customer_id"] == customer_id].copy()

    if df.empty:
        return {"error": "Customer not found"}

    # Compute features again
    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df["consumption_kwh"].diff().fillna(0)
    if model is not None:
        X = df[["consumption_kwh", "billed_kwh", "ratio", "monthly_change"]].fillna(0)
        if scaler is not None:
            X = scaler.transform(X)
        df["anomaly_score"] = model.score_samples(X)
    else:
        df["anomaly_score"] = 0

    df["month"] = pd.to_datetime(df["month"]).dt.strftime("%Y-%m-%d")
    return {"customer_id": customer_id, "records": df.to_dict(orient="records")}
