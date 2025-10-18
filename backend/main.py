# ⚡ WattAudit++ Explainable AI Backend — Hybrid Live + Local Version (Frontend Synced)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
import joblib
import os
import numpy as np
import psycopg2
from sqlalchemy import create_engine
from deep_translator import GoogleTranslator
from dotenv import load_dotenv
from backend.api import anomalies, predict, insights
from sklearn.preprocessing import MinMaxScaler
from fastapi.responses import JSONResponse

# ---------- CONFIG & PATHS ----------
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "data")
MODEL_DIR = os.path.join(BASE_DIR, "..", "models")

MODEL_PATH = os.path.join(MODEL_DIR, "anomaly_model.pkl")
SCALER_PATH = os.path.join(MODEL_DIR, "scaler.pkl")
LOCAL_DATA_PATH = os.path.join(DATA_DIR, "dummy_billing_dataset.csv")
CUSTOMER_INFO_PATH = os.path.join(DATA_DIR, "synthetic_mh_customers.csv")
NEON_CONN = os.getenv("NEON_CONN")

FEATURES = [
    "consumption_kwh",
    "billed_kwh",
    "ratio",
    "monthly_change",
    "cat_dev",
    "billing_gap",
]

HYBRID_META_PATH = os.path.join(MODEL_DIR, "meta_model.pkl")
HYBRID_FEATURES = [
    "consumption_kwh",
    "billed_kwh",
    "ratio",
    "monthly_change",
    "cat_dev",
    "billing_gap",
    "rolling_avg_3m",
    "rolling_std_3m",
    "volatility",
    "billing_efficiency",
    "season_sin",
    "season_cos",
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

# ---------- INCLUDE ROUTERS ----------
app.include_router(anomalies.router, prefix="/api")
app.include_router(predict.router, prefix="/api")
app.include_router(insights.router, prefix="/api")

# ---------- HELPERS & NORMALIZATION ----------
def normalize_cust_id(cust_id: str) -> str:
    """Normalize customer IDs like 'cust1001', '1001' → 'CUST1001'."""
    if not isinstance(cust_id, str):
        cust_id = str(cust_id)
    cust_id = cust_id.strip().upper()
    digits = "".join(filter(str.isdigit, cust_id))
    if digits:
        # preserve integer conversion to drop accidental leading zeros
        return f"CUST{int(digits)}"
    # fallback: ensure it starts with CUST
    if not cust_id.startswith("CUST"):
        return f"CUST{cust_id}"
    return cust_id

def safe_load(path, name):
    try:
        obj = joblib.load(path)
        print(f"✅ {name} loaded successfully.")
        return obj
    except Exception as e:
        print(f"⚠️ {name} missing or failed to load: {e}")
        return None

# ---------- LOAD MODELS & SCALERS ----------
model = safe_load(MODEL_PATH, "Model")
scaler = safe_load(SCALER_PATH, "Scaler")
meta_model = safe_load(HYBRID_META_PATH, "Meta-model")

# ---------- LOAD LOCAL DATA ----------
try:
    df_local = pd.read_csv(LOCAL_DATA_PATH, parse_dates=["month"], dayfirst=True)
    print(f"✅ Local dataset loaded: {len(df_local)} rows, {len(df_local.columns)} cols.")
except Exception as e:
    print(f"⚠️ Error loading {LOCAL_DATA_PATH}: {e}")
    try:
        df_local = pd.read_csv(LOCAL_DATA_PATH, sep="\t", parse_dates=["month"], dayfirst=True)
        print(f"✅ Retried with tab separator: {len(df_local)} rows.")
    except Exception as e2:
        df_local = pd.DataFrame()
        print(f"❌ Failed to load dataset completely: {e2}")

# Normalize IDs in local data
if not df_local.empty and "customer_id" in df_local.columns:
    df_local["customer_id"] = df_local["customer_id"].apply(normalize_cust_id)

try:
    df_customers = pd.read_csv(CUSTOMER_INFO_PATH)
    print(f"✅ Customer profiles loaded: {len(df_customers)} customers.")
    if "customer_id" in df_customers.columns:
        df_customers["customer_id"] = df_customers["customer_id"].apply(normalize_cust_id)
    # Ensure standard column name exists
    if "consumer_category" not in df_customers.columns and "category" in df_customers.columns:
        df_customers.rename(columns={"category": "consumer_category"}, inplace=True)
except Exception as e:
    df_customers = pd.DataFrame()
    print(f"⚠️ Could not load customer profiles: {e}")

# ---------- LABEL NORMALIZATION ----------
# Ensure numeric anomaly labels exist for backward compatibility
if "anomaly_label" not in df_local.columns:
    if "anomaly_type" in df_local.columns:
        df_local["anomaly_label"] = np.where(df_local["anomaly_type"] == "Normal", 1, -1)
        print("🧩 Converted 'anomaly_type' → numeric 'anomaly_label' (-1/1).")
    else:
        # No label info present — default to normal
        df_local["anomaly_label"] = 1
        print("⚠️ No anomaly label columns found; defaulting to all Normal (1).")


# ---------- LOAD ADDITIONAL MODELS/SCALERS ----------
LOF_PATH = os.path.join(MODEL_DIR, "lof_model.pkl")
ISO_SCORE_SCALER_PATH = os.path.join(MODEL_DIR, "iso_score_scaler.pkl")
LOF_SCORE_SCALER_PATH = os.path.join(MODEL_DIR, "lof_score_scaler.pkl")
META_SCORE_SCALER_PATH = os.path.join(MODEL_DIR, "meta_score_scaler.pkl")

lof_model = safe_load(LOF_PATH, "LOF model")
iso_score_scaler = safe_load(ISO_SCORE_SCALER_PATH, "ISO score scaler")
lof_score_scaler = safe_load(LOF_SCORE_SCALER_PATH, "LOF score scaler")
meta_score_scaler = safe_load(META_SCORE_SCALER_PATH, "Meta score scaler")

# ---------- BEST PARAMS & THRESHOLD ----------
BEST_PARAMS_PATH = os.path.join(MODEL_DIR, "best_params.pkl")
try:
    best_params = joblib.load(BEST_PARAMS_PATH)
    print("✅ Loaded best params:", best_params)
except Exception:
    best_params = {}
    print("⚠️ best_params not found — using defaults.")

try:
    best_threshold = float(best_params.get("threshold_pct", 5)) / 100.0
    if not (0 < best_threshold < 1):
        best_threshold = 0.05
except Exception:
    best_threshold = 0.05
print(f"⚙️ Using anomaly threshold quantile = {best_threshold:.3f}")

# ---------- SMALL HELPERS ----------
def _rescaled_confidence(score: float) -> float:
    scaled_score = max(min(score, 0.3), -0.3)
    return round((1 - ((scaled_score + 0.3) / 0.6)) * 100, 2)

def generate_reason(record):
    ratio = record.get("ratio", 1.0)
    monthly_change = record.get("monthly_change", 0.0)
    anomaly_score = record.get("anomaly_score", 0.0)
    anomaly_label = record.get("anomaly_label", 1)
    reasons = []
    if ratio < 0.85:
        reasons.append("⚠️ Under-billing detected")
    elif ratio > 1.3:
        reasons.append("⚠️ Over-billing detected")
    if abs(monthly_change) > 100:
        reasons.append("⚡ Sudden change in consumption pattern")
    if anomaly_label == -1:
        reasons.append(f"🤖 AI flagged this as anomalous (score={anomaly_score:.3f})")
    else:
        reasons.append(f"✅ Stable consumption pattern (score={anomaly_score:.3f})")
    return " | ".join(reasons)

def generate_summary(cust_id: str, df: pd.DataFrame):
    anomaly_count = int((df["anomaly_label"] == -1).sum())
    total_months = len(df)
    score_avg = df["anomaly_score"].mean()

    meta = df_customers[df_customers["customer_id"] == cust_id]
    if not meta.empty:
        meta_row = meta.iloc[0].to_dict()
        category = meta_row.get("consumer_category", "Unknown")
        district = meta_row.get("district", "Unknown")
        install_year = meta_row.get("install_year", "N/A")
    else:
        category, district, install_year = "Unknown", "Unknown", "N/A"

    if anomaly_count == 0:
        base_summary = (
            f"Customer {cust_id} ({category}, {district}) shows a stable consumption "
            f"pattern with no anomalies detected over {total_months} months "
            f"(installed in {install_year}). Average anomaly score: {score_avg:.3f}."
        )
    else:
        base_summary = (
            f"Customer {cust_id} ({category}, {district}) shows {anomaly_count} anomalies "
            f"out of {total_months} months (installed in {install_year}). "
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

# ---------- UNIFIED HYBRID SCORING ----------
def compute_hybrid_scores(df: pd.DataFrame) -> pd.DataFrame:
    """Apply hybrid anomaly scoring logic consistent with evaluate_and_log.py."""
    if model is None:
        df["anomaly_score"], df["anomaly_label"] = 0.0, 1
        return df

    # Compute engineered features if missing
    if "ratio" not in df.columns:
        df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    if "monthly_change" not in df.columns:
        df["monthly_change"] = df.groupby("customer_id")["consumption_kwh"].diff().fillna(0)
    if "billing_gap" not in df.columns:
        df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]

    # Rolling stats & derived features
    df["rolling_avg_3m"] = (
        df.groupby("customer_id")["consumption_kwh"]
        .rolling(3, min_periods=1).mean().reset_index(0, drop=True)
    )
    df["rolling_std_3m"] = (
        df.groupby("customer_id")["consumption_kwh"]
        .rolling(3, min_periods=1).std().reset_index(0, drop=True).fillna(0)
    )
    df["volatility"] = df["rolling_std_3m"] / (df["rolling_avg_3m"] + 1)
    df["billing_efficiency"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["season_sin"] = np.sin(2 * np.pi * df["month"].dt.month / 12)
    df["season_cos"] = np.cos(2 * np.pi * df["month"].dt.month / 12)

    X_full = df[HYBRID_FEATURES].fillna(0)

    # Align columns to scaler if available
    if scaler is not None:
        expected_cols = getattr(scaler, "feature_names_in_", None)
        if expected_cols is not None:
            for c in expected_cols:
                if c not in X_full.columns:
                    X_full[c] = 0
            X_full = X_full[expected_cols]
        X_full = scaler.transform(X_full)

    # Core model scores
    df["iso_score"] = model.score_samples(X_full)

    if lof_model is not None:
        try:
            df["lof_score"] = -lof_model.score_samples(X_full)
        except Exception:
            df["lof_score"] = (
                -lof_model._decision_function(X_full)
                if hasattr(lof_model, "_decision_function")
                else 0
            )
    else:
        from sklearn.neighbors import LocalOutlierFactor
        _lof = LocalOutlierFactor(n_neighbors=20, contamination=0.05, novelty=True)
        _lof.fit(X_full)
        df["lof_score"] = -_lof.score_samples(X_full)

    # Normalize scores
    df["iso_norm"] = (
        iso_score_scaler.transform(df[["iso_score"]])
        if iso_score_scaler
        else MinMaxScaler().fit_transform(df[["iso_score"]])
    )
    df["lof_norm"] = (
        lof_score_scaler.transform(df[["lof_score"]])
        if lof_score_scaler
        else MinMaxScaler().fit_transform(df[["lof_score"]])
    )

    # Combine core scores
    df["combined_score"] = 0.5 * df["iso_norm"] + 0.5 * df["lof_norm"]

    # Rule-based feature
    under = (df["ratio"] < 0.85).astype(int)
    over = (df["ratio"] > 1.3).astype(int)
    df["rule_flag"] = under | over

    # Meta-model blending
    if meta_model is not None:
        meta_features = df[["iso_score", "lof_score", "rule_flag"]]
        try:
            df["meta_prob"] = meta_model.predict_proba(meta_features)[:, 1]
            df["meta_norm"] = (
                meta_score_scaler.transform(df[["meta_prob"]])
                if meta_score_scaler
                else MinMaxScaler().fit_transform(df[["meta_prob"]])
            )
        except Exception:
            df["meta_norm"] = 0
    else:
        df["meta_norm"] = 0

    # Weighted ensemble
    df["anomaly_score"] = (
        0.7 * df["combined_score"] + 0.3 * df["meta_norm"] - df["rule_flag"] * 0.2
    )

    # Threshold from tuned quantile
    threshold = df["anomaly_score"].quantile(best_threshold)
    flagged = (df["anomaly_score"] < threshold).sum()
    if flagged == 0:
        threshold = df["anomaly_score"].quantile(0.25)

    df["anomaly_label"] = np.where(df["anomaly_score"] < threshold, -1, 1)
    df["anomaly_status"] = np.where(df["anomaly_label"] == -1, "Anomalous", "Normal")

    return df


# ---------- ROUTES ----------
@app.get("/")
def root():
    return {"message": "⚡ WattAudit++ Hybrid AI Backend is live (Neon + Local fallback)."}

@app.get("/customers")
def get_customers(limit: int = 500):
    """Return top customers with anomaly summary for dashboard."""
    try:
        if df_local.empty:
            return {"top_customers": [], "total_alerts": 0}

        df = df_local.copy()
        # Ensure month is datetime
        df = df.sort_values(["customer_id", "month"])
        if not np.issubdtype(df["month"].dtype, np.datetime64):
            df["month"] = pd.to_datetime(df["month"], errors="coerce")

        # Feature engineering
        df["consumption_kwh"] = pd.to_numeric(df["consumption_kwh"], errors="coerce").fillna(0)
        df["billed_kwh"] = pd.to_numeric(df["billed_kwh"], errors="coerce").fillna(0)

        df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
        df["monthly_change"] = df.groupby("customer_id")["consumption_kwh"].diff().fillna(0)
        cat_avg = df.groupby("consumer_category")["consumption_kwh"].transform("mean") if "consumer_category" in df.columns else 0
        df["cat_dev"] = df["consumption_kwh"] - cat_avg
        df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]

        # Hybrid scoring (preserve model logic)
        if model is not None:
           df = compute_hybrid_scores(df)
        else:
           df["anomaly_score"], df["anomaly_label"] = 0.0, 1

        # persistent anomaly
        df["anomaly_label_bool"] = (df["anomaly_label"] == -1).astype(int)
        df["persistent_anomaly"] = (
            df.groupby("customer_id")["anomaly_label_bool"]
            .rolling(2, min_periods=1)
            .sum()
            .reset_index(0, drop=True)
            .ge(2)
            .astype(int)
        )

        total_alerts = int((df["anomaly_label"] == -1).sum())

        agg = (
            df.groupby(["customer_id", "consumer_category"])
            .agg(
                avg_anomaly_score=("anomaly_score", "mean"),
                ratio=("ratio", "mean"),
                monthly_change=("monthly_change", "mean"),
                consumption_kwh=("consumption_kwh", "mean"),
                anomaly_label=("anomaly_label", "min"),
                persistent_anomaly=("persistent_anomaly", "max"),
            )
            .reset_index()
        )

        # merge with customer profiles if available
        if not df_customers.empty:
            agg = agg.merge(df_customers, on="customer_id", how="left")
            # fix duplicate consumer_category columns from merge
            if "consumer_category_x" in agg.columns:
                agg = agg.rename(columns={"consumer_category_x": "consumer_category"})
            if "consumer_category_y" in agg.columns:
                agg = agg.drop(columns=["consumer_category_y"], errors="ignore")

        agg["consumer_category"] = agg.get("consumer_category", pd.Series()).fillna("Unknown").astype(str)
        agg["reason"] = agg.apply(generate_reason, axis=1)

        agg = agg.replace([np.nan, np.inf, -np.inf], 0)
        agg = agg.sort_values("avg_anomaly_score").head(50)

        return {"top_customers": agg.to_dict(orient="records"), "total_alerts": total_alerts}

    except Exception as e:
        print("GET /customers error:", e)
        return {"top_customers": [], "total_alerts": 0}

# ---------- CUSTOMER DETAILS ----------
@app.get("/customer/{cust_id}")
def get_customer(cust_id: str):
    """Return detailed anomaly profile for a single customer (live + explainable)."""
    print("🔹 /customer endpoint called with ID:", cust_id)
    cust_id = normalize_cust_id(cust_id)
    print("🔍 Normalized customer_id:", cust_id)

    try:
        # Fetch from Neon DB or fallback local data
        if NEON_CONN:
            conn = psycopg2.connect(NEON_CONN)
            query = "SELECT * FROM billing_data WHERE customer_id = %s ORDER BY month;"
            df = pd.read_sql(query, conn, params=[cust_id])
            conn.close()
        else:
            df = df_local[df_local["customer_id"] == cust_id].copy()
    except Exception as e:
        return JSONResponse(content={"error": f"DB read error: {e}"}, status_code=500)

    if df.empty:
        return JSONResponse(content={"error": "Customer not found."}, status_code=404)

    # --- Clean data ---
    df = df.replace([np.inf, -np.inf], np.nan).fillna(0)
    df["consumption_kwh"] = pd.to_numeric(df["consumption_kwh"], errors="coerce").fillna(0)
    df["billed_kwh"] = pd.to_numeric(df["billed_kwh"], errors="coerce").fillna(0)

    # --- Compute ratio and base features ---
    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df["consumption_kwh"].diff().fillna(0)
    df["cat_dev"] = df["consumption_kwh"] - df["consumption_kwh"].mean()
    df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]

    # --- Apply unified hybrid scoring (identical to training logic) ---
    df = compute_hybrid_scores(df)

    # --- Replace NaNs and infinite values ---
    df = df.replace([np.nan, np.inf, -np.inf], 0)

    # --- Generate summary & explanations ---
    summary_en, summary_hi, summary_mr = generate_summary(cust_id, df)

    # Pull static customer info
    cust_profile = df_customers[df_customers["customer_id"] == cust_id].to_dict(orient="records")
    cust_profile = cust_profile[0] if cust_profile else {"note": "No profile found"}

    # Use the most recent month’s record for AI analysis preview
    latest = df.sort_values("month").tail(1).iloc[0]
    reason = generate_reason(latest)
    score = float(latest.get("anomaly_score", 0))
    label = int(latest.get("anomaly_label", 1))
    confidence = _rescaled_confidence(score)
    df["month"] = pd.to_datetime(df["month"]).dt.strftime("%Y-%m-%d")

    # --- Add key debug metadata ---
    print(f"📊 Customer {cust_id} | score={score:.4f} | label={label} | threshold={best_threshold:.3f}")

    # --- Response ---
    response = {
        "customer_id": cust_id,
        "profile": cust_profile,
        "records": df.to_dict(orient="records"),
        "summary": {
            "english": summary_en,
            "hindi": summary_hi,
            "marathi": summary_mr,
        },
        "ai_analysis": {
            "anomaly_score": round(score, 4),
            "anomaly_label": int(label),
            "confidence_score": confidence,
            "threshold_used": round(best_threshold, 3),
            "reason": reason,
        },
    }

    return JSONResponse(content=response, status_code=200)

# ---------- PREDICT ENDPOINT ----------
class PredictRequest(BaseModel):
    consumption_kwh: float
    billed_kwh: float
    category: str = "Residential"

@app.post("/predict")
def predict(req: PredictRequest):
    """AI prediction for a single input (real-time anomaly detection)."""
    try:
        # --- Basic engineered features ---
        ratio = req.billed_kwh / (req.consumption_kwh + 1)
        sample = pd.DataFrame(
            [
                {
                    "consumption_kwh": req.consumption_kwh,
                    "billed_kwh": req.billed_kwh,
                    "ratio": ratio,
                    "monthly_change": 0.0,
                    "cat_dev": 0.0,
                    "billing_gap": req.consumption_kwh - req.billed_kwh,
                    "rolling_avg_3m": req.consumption_kwh,
                    "rolling_std_3m": 0.0,
                    "volatility": 0.0,
                    "billing_efficiency": req.billed_kwh / (req.consumption_kwh + 1),
                    "season_sin": np.sin(2 * np.pi * (pd.Timestamp.now().month) / 12),
                    "season_cos": np.cos(2 * np.pi * (pd.Timestamp.now().month) / 12),
                }
            ]
        )

        # --- Validate model availability ---
        if model is None:
            return {"error": "Model not available"}

        # --- Scaling ---
        X = sample[HYBRID_FEATURES].fillna(0)
        if scaler is not None:
            expected_cols = getattr(scaler, "feature_names_in_", None)
            if expected_cols is not None:
                missing_cols = [c for c in expected_cols if c not in X.columns]
                for c in missing_cols:
                    X[c] = 0
                X = X[expected_cols]
            X = scaler.transform(X)

        # --- Core anomaly scores ---
        iso_score = float(model.score_samples(X)[0])
        if lof_model is not None:
            try:
                lof_score = -float(lof_model.score_samples(X)[0])
            except Exception:
                lof_score = (
                    -float(lof_model._decision_function(X)[0])
                    if hasattr(lof_model, "_decision_function")
                    else 0
                )
        else:
            lof_score = 0

        # --- Normalize scores ---
        iso_norm = (
            float(iso_score_scaler.transform([[iso_score]])[0][0])
            if iso_score_scaler is not None
            else float(MinMaxScaler().fit_transform([[iso_score]])[0][0])
        )
        lof_norm = (
            float(lof_score_scaler.transform([[lof_score]])[0][0])
            if lof_score_scaler is not None
            else float(MinMaxScaler().fit_transform([[lof_score]])[0][0])
        )

        combined = 0.5 * iso_norm + 0.5 * lof_norm

        # --- Rule-based adjustment ---
        rule_flag = 1 if (ratio < 0.85 or ratio > 1.3) else 0

        # --- Meta-model blending (if available) ---
        meta_norm_val = 0
        if meta_model is not None:
            try:
                meta_prob = meta_model.predict_proba([[iso_score, lof_score, rule_flag]])[:, 1][0]
                meta_norm_val = (
                    float(meta_score_scaler.transform([[meta_prob]])[0][0])
                    if meta_score_scaler is not None
                    else float(MinMaxScaler().fit_transform([[meta_prob]])[0][0])
                )
            except Exception:
                meta_norm_val = 0

        # --- Final ensemble score ---
        score = 0.7 * combined + 0.3 * meta_norm_val - rule_flag * 0.2

        # --- Labeling (use consistent threshold from training) ---
        label = -1 if score < best_threshold else 1

        # --- Confidence + Explanation ---
        confidence = _rescaled_confidence(score)
        reason = generate_reason(
            {
                "ratio": ratio,
                "monthly_change": 0.0,
                "consumption_kwh": req.consumption_kwh,
                "anomaly_score": score,
                "anomaly_label": label,
            }
        )

        # --- Final response ---
        return {
            "score": round(score, 4),
            "label": int(label),
            "threshold_used": round(best_threshold, 3),
            "confidence_score": confidence,
            "reason": reason,
        }

    except Exception as e:
        return {"error": f"Prediction failed: {e}"}

# ---------- AI INSIGHTS ----------
@app.post("/ai_insights")
def generate_ai_insights(payload: dict):
    cust_id = payload.get("customer_id")
    lang = payload.get("lang", "en")
    records = payload.get("records", [])

    if not cust_id or not records:
        return {"summary": "No data available for insights."}

    df = pd.DataFrame(records)
    base, hi, mr = generate_summary(cust_id, df)
    if lang.startswith("hi"):
        return {"summary": hi}
    elif lang.startswith("mr"):
        return {"summary": mr}
    else:
        return {"summary": base}
