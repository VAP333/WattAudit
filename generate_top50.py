# generate_top50.py
import os
import pandas as pd
import joblib
from sklearn.preprocessing import MinMaxScaler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "models")

# Load dataset
df = pd.read_csv(os.path.join(DATA_DIR, "dummy_billing_dataset.csv"), parse_dates=["month"])

# -------- Feature Engineering (same as train_model.py) --------
def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["customer_id", "month"]).copy()
    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df.groupby("customer_id")["consumption_kwh"].diff().fillna(0)
    cat_avg = df.groupby("consumer_category")["consumption_kwh"].transform("mean")
    df["cat_dev"] = df["consumption_kwh"] - cat_avg
    df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]
    return df

df = add_features(df)

FEATURES = [
    "consumption_kwh",
    "billed_kwh",
    "ratio",
    "monthly_change",
    "cat_dev",
    "billing_gap",
]

# -------- Load model + scaler --------
model_path = os.path.join(MODEL_DIR, "anomaly_model.pkl")
scaler_path = os.path.join(MODEL_DIR, "scaler.pkl")

if not (os.path.exists(model_path) and os.path.exists(scaler_path)):
    raise FileNotFoundError("❌ Missing trained model/scaler. Run train_model.py first!")

iso = joblib.load(model_path)
scaler = joblib.load(scaler_path)

# -------- Apply model --------
X = df[FEATURES].fillna(0)
X_scaled = scaler.transform(X)

df["anomaly_score"] = iso.score_samples(X_scaled)   # ✅ instead of decision_function
df["anomaly_label"] = iso.predict(X_scaled)

# -------- Aggregate per customer --------
customer_scores = (
    df.groupby("customer_id")["anomaly_score"]
    .mean()
    .reset_index()
    .sort_values("anomaly_score")   # lower = more anomalous
)

# -------- Save top 50 --------
top50 = customer_scores.head(50)
out_file = os.path.join(DATA_DIR, "top50_suspicious_customers.csv")
top50.to_csv(out_file, index=False)

print(f"✅ Top 50 suspicious customers saved to: {out_file}")
