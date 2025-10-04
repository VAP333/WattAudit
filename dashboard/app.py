# dashboard/app.py

import streamlit as st
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
import os

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

# --------- Dashboard UI ---------
st.title("⚡ WattAudit++ - Billing Anomaly Dashboard")

# Show top flagged customers with scores
st.subheader("Top 50 Suspicious Customers (Ranked by Anomaly Score)")
st.dataframe(top50)

# Customer selector
cust_id = st.selectbox("🔎 Select a Customer to Inspect", top50["customer_id"].tolist())

if cust_id:
    cust_data = df[df["customer_id"] == cust_id]

    st.subheader(f"📊 Consumption Pattern for {cust_id}")
    fig, ax = plt.subplots(figsize=(10, 4))
    sns.lineplot(data=cust_data, x="month", y="consumption_kwh", marker="o", ax=ax)
    ax.set_ylabel("Consumption (kWh)")
    st.pyplot(fig)

    # Show details
    st.subheader("📄 Billing & Customer Details")
    st.write(cust_data[["month", "consumption_kwh", "billed_kwh", "consumer_category", "feeder_id"]])
