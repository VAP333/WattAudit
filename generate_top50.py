import pandas as pd
from sklearn.ensemble import IsolationForest
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")

# Load dummy dataset
df = pd.read_csv(os.path.join(DATA_DIR, "dummy_billing_dataset.csv"), parse_dates=["month"])

# Features for anomaly detection
features = ["consumption_kwh", "billed_kwh"]
X = df[features].fillna(0)

# Train Isolation Forest
iso = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
iso.fit(X)   # 👈 THIS WAS MISSING
df["anomaly_score"] = iso.decision_function(X)

# Aggregate scores per customer
customer_scores = df.groupby("customer_id")["anomaly_score"].mean().reset_index()
customer_scores = customer_scores.sort_values("anomaly_score")  # lower = more anomalous

# Save top 50
top50 = customer_scores.head(50)
out_file = os.path.join(DATA_DIR, "top50_suspicious_customers.csv")
top50.to_csv(out_file, index=False)
print(f"✅ Top 50 suspicious customers saved to: {out_file}")
