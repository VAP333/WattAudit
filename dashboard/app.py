# dashboard/app.py

import streamlit as st
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
import os
from deep_translator import GoogleTranslator   # ✅ new translator library

# --------- Path Handling ---------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")

# --------- Load Data ---------
@st.cache_data
def load_data():
    df = pd.read_csv(os.path.join(DATA_DIR, "dummy_billing_dataset.csv"), parse_dates=["month"])
    top50 = pd.read_csv(os.path.join(DATA_DIR, "top50_suspicious_customers.csv"))
    return df, top50

df, top50 = load_data()

# --------- Helper: Generate Multilingual Summaries ---------
def generate_summary(cust_id, data):
    avg_consumption = data["consumption_kwh"].mean()
    avg_billing = data["billed_kwh"].mean()

    # English summary
    summary_en = (
        f"Customer {cust_id} shows unusual billing. "
        f"Average consumption is {avg_consumption:.1f} kWh, "
        f"but billed units average {avg_billing:.1f} kWh. "
        f"Possible anomaly detected."
    )

    # Translations (using deep-translator)
    try:
        summary_hi = GoogleTranslator(source="en", target="hi").translate(summary_en)
        summary_mr = GoogleTranslator(source="en", target="mr").translate(summary_en)
    except Exception:
        summary_hi = "⚠️ Translation unavailable"
        summary_mr = "⚠️ Translation unavailable"

    return summary_en, summary_hi, summary_mr

# --------- Dashboard UI ---------
st.title("⚡ WattAudit++ - Billing Anomaly Dashboard")
st.markdown("🔎 Using **Improved Anomaly Detection Model** (Isolation Forest + LOF)")

# Show top flagged customers with scores
st.subheader("📌 Top 50 Suspicious Customers (Ranked by Anomaly Score)")
st.dataframe(top50)

# Customer selector
cust_id = st.selectbox("🔎 Select a Customer to Inspect", top50["customer_id"].tolist())

if cust_id:
    cust_data = df[df["customer_id"] == cust_id]

    # Consumption vs Time plot
    st.subheader(f"📊 Consumption Pattern for {cust_id}")
    fig, ax = plt.subplots(figsize=(10, 4))
    sns.lineplot(data=cust_data, x="month", y="consumption_kwh", marker="o", ax=ax, label="Consumption (kWh)")
    sns.lineplot(data=cust_data, x="month", y="billed_kwh", marker="o", ax=ax, label="Billed (kWh)")
    ax.set_ylabel("kWh")
    ax.legend()
    st.pyplot(fig)

    # Show details
    st.subheader("📄 Billing & Customer Details")
    st.write(cust_data[["month", "consumption_kwh", "billed_kwh", "consumer_category", "feeder_id"]])

    # AI-generated summaries
    st.subheader("📝 AI-Generated Report")
    en, hi, mr = generate_summary(cust_id, cust_data)
    st.markdown(f"**English:** {en}")
    st.markdown(f"**हिंदी:** {hi}")
    st.markdown(f"**मराठी:** {mr}")
