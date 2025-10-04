# app.py - Streamlit Dashboard for WattAudit++

import streamlit as st
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
import os
import joblib
from deep_translator import GoogleTranslator

# --------- Page Config ---------
st.set_page_config(page_title="WattAudit++ Dashboard", page_icon="⚡", layout="wide")

# --------- Path Handling ---------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # go up to WattAudit++ root
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "models")

# --------- Load Data & Model ---------
@st.cache_data
def load_data():
    file_path = os.path.join(DATA_DIR, "dummy_billing_dataset.csv")
    if not os.path.exists(file_path):
        st.error("❌ Data file not found. Run prepare/train scripts first.")
        return pd.DataFrame()
    return pd.read_csv(file_path, parse_dates=["month"])

@st.cache_resource
def load_model():
    file_path = os.path.join(MODEL_DIR, "anomaly_model.pkl")
    if not os.path.exists(file_path):
        st.error("❌ Model not found. Train it first.")
        return None
    return joblib.load(file_path)

df = load_data()
model = load_model()

# --------- Feature Engineering ---------
def add_features(df):
    if df.empty:
        return df
    df = df.sort_values(["customer_id", "month"]).copy()
    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df.groupby("customer_id")["consumption_kwh"].diff().fillna(0)
    category_avg = df.groupby("consumer_category")["consumption_kwh"].transform("mean")
    df["cat_dev"] = df["consumption_kwh"] - category_avg
    df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]
    return df

if not df.empty and model is not None:
    df = add_features(df)

    # --------- Apply Model ---------
    features = ["consumption_kwh", "billed_kwh", "ratio", "monthly_change", "cat_dev", "billing_gap"]
    df["anomaly_score"] = model.decision_function(df[features].fillna(0))
    df["anomaly_label"] = model.predict(df[features].fillna(0))  # -1 anomaly, 1 normal

    # Rank suspicious customers
    top50 = (
        df.groupby("customer_id")["anomaly_score"]
        .mean()
        .reset_index()
        .sort_values("anomaly_score")
        .head(50)
    )
else:
    top50 = pd.DataFrame()

# --------- Helper: Generate Summaries ---------
def generate_summary(cust_id, data):
    avg_consumption = data["consumption_kwh"].mean()
    avg_billing = data["billed_kwh"].mean()

    summary_en = (
        f"Customer {cust_id} shows unusual billing behavior. "
        f"Average consumption: {avg_consumption:.1f} kWh, "
        f"billed: {avg_billing:.1f} kWh. "
        f"⚠️ Possible anomaly detected."
    )

    # Generic multilingual support (Hindi & Marathi)
    try:
        summary_hi = GoogleTranslator(source="en", target="hi").translate(summary_en)
        summary_mr = GoogleTranslator(source="en", target="mr").translate(summary_en)
    except Exception:
        summary_hi, summary_mr = "⚠️ Translation unavailable", "⚠️ Translation unavailable"

    return summary_en, summary_hi, summary_mr

# --------- Dashboard UI ---------
st.title("⚡ WattAudit++ - Billing Anomaly Detection")
st.markdown("🔍 **AI-Powered Fraud/Anomaly Detection for Electricity Billing**")

if df.empty or model is None:
    st.stop()

# --- Global Overview ---
st.subheader("📈 Dataset Overview")
col1, col2 = st.columns(2)
with col1:
    st.metric("Total Customers", df["customer_id"].nunique())
with col2:
    st.metric("Total Records", len(df))

st.write(df.head())

# --- Suspicious Customers ---
st.subheader("📌 Top 50 Suspicious Customers")
st.dataframe(top50)

# --- Customer Analysis ---
if not top50.empty:
    cust_id = st.selectbox("🔎 Select a Customer to Inspect", top50["customer_id"].tolist())
    if cust_id:
        cust_data = df[df["customer_id"] == cust_id]

        st.subheader(f"📊 Consumption vs Billing for {cust_id}")
        fig, ax = plt.subplots(figsize=(10, 4))
        sns.lineplot(data=cust_data, x="month", y="consumption_kwh", marker="o", ax=ax, label="Consumption (kWh)")
        sns.lineplot(data=cust_data, x="month", y="billed_kwh", marker="o", ax=ax, label="Billed (kWh)")
        ax.set_ylabel("kWh")
        ax.legend()
        st.pyplot(fig)

        # Detailed billing table
        st.subheader("📄 Detailed Records")
        st.write(cust_data[[
            "month", "consumption_kwh", "billed_kwh", "consumer_category", "anomaly_score", "anomaly_label"
        ]])

        # Generic Summary
        st.subheader("📝 Summary")
        en, hi, mr = generate_summary(cust_id, cust_data)
        st.markdown(f"**English:** {en}")
        st.markdown(f"**हिंदी:** {hi}")
        st.markdown(f"**मराठी:** {mr}")
