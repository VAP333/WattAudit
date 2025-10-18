# train_model.py (updated hybrid anomaly logic + persistence + normalization)

import os
import pandas as pd
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import MinMaxScaler
import joblib
from utils.synthetic import inject_synthetic_anomalies_per_customer  # ✅ use utility

# --------- Paths ---------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
MODEL_DIR = os.path.join(BASE_DIR, "models")
os.makedirs(MODEL_DIR, exist_ok=True)

# --------- Load Data ---------
df = pd.read_csv(os.path.join(DATA_DIR, "dummy_billing_dataset.csv"), parse_dates=["month"])

# --------- Feature Engineering ---------
def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["customer_id", "month"]).copy()

    # Core ratios
    df["ratio"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["monthly_change"] = df.groupby("customer_id")["consumption_kwh"].diff().fillna(0)
    category_avg = df.groupby("consumer_category")["consumption_kwh"].transform("mean")
    df["cat_dev"] = df["consumption_kwh"] - category_avg
    df["billing_gap"] = df["consumption_kwh"] - df["billed_kwh"]

    # ⚡ Advanced temporal & behavioral features
    df["rolling_avg_3m"] = (
        df.groupby("customer_id")["consumption_kwh"]
        .rolling(3, min_periods=1)
        .mean()
        .reset_index(0, drop=True)
    )
    df["rolling_std_3m"] = (
        df.groupby("customer_id")["consumption_kwh"]
        .rolling(3, min_periods=1)
        .std()
        .reset_index(0, drop=True)
        .fillna(0)
    )
    df["volatility"] = df["rolling_std_3m"] / (df["rolling_avg_3m"] + 1)
    df["billing_efficiency"] = df["billed_kwh"] / (df["consumption_kwh"] + 1)
    df["season_sin"] = np.sin(2 * np.pi * df["month"].dt.month / 12)
    df["season_cos"] = np.cos(2 * np.pi * df["month"].dt.month / 12)

    return df

df = add_features(df)

# --------- Step 1: Inject Synthetic Anomalies ---------
df = inject_synthetic_anomalies_per_customer(
    df, customer_frac=0.05, months_frac=0.3, seed=42
)

# --------- Step 2: Features ---------
FEATURES = [
    "consumption_kwh",
    "billed_kwh",
    "ratio",
    "monthly_change",
    "cat_dev",
    "billing_gap",
]
FEATURES = [
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
X = df[FEATURES].fillna(0)

# --------- Step 3: Load Best Params (if available) ---------
best_params_path = os.path.join(MODEL_DIR, "best_params.pkl")
if os.path.exists(best_params_path):
    best_params = joblib.load(best_params_path)
    print("✅ Loaded best params from Optuna:", best_params)
else:
    print("⚠️ No tuned params found, falling back to defaults.")
    best_params = {
        "iso_contamination": 0.05,
        "n_estimators": 100,
        "max_samples": 0.8,
        "lof_n_neighbors": 20,
        "lof_contamination": 0.05,
        "alpha": 0.5,
    }


# --------- Step 4: Train Models with Tuned Params ---------
# Scale original FEATURES for consistency with inference and training
feature_scaler = MinMaxScaler()
X_scaled = feature_scaler.fit_transform(X)

# Isolation Forest trained on scaled features
iso = IsolationForest(
    contamination=best_params["iso_contamination"],
    n_estimators=best_params["n_estimators"],
    max_samples=best_params["max_samples"],
    random_state=42,
)
df["iso_pred"] = iso.fit_predict(X_scaled)
# Use score_samples on the scaled features
df["iso_score"] = iso.score_samples(X_scaled)

# Local Outlier Factor trained on scaled features
# Local Outlier Factor trained on scaled features — continuous scoring version
lof = LocalOutlierFactor(
    n_neighbors=best_params["lof_n_neighbors"],
    contamination=best_params["lof_contamination"],
    novelty=True  # ✅ enables scoring on same data
)
lof.fit(X_scaled)
df["lof_score"] = -lof.score_samples(X_scaled)  # higher = more anomalous


# --------- Step 5: Improved Hybrid Scoring ---------
# Normalize the iso_score and lof_pred for hybrid scoring
df["iso_norm"] = MinMaxScaler().fit_transform(df[["iso_score"]])
df["lof_norm"] = MinMaxScaler().fit_transform(df[["lof_score"]])
 # LOF outputs -1/1 → abs makes consistent

alpha = best_params.get("alpha", 0.5)
df["combined_score"] = alpha * df["iso_norm"] + (1 - alpha) * df["lof_norm"]

# --- Rule-based anomaly (both under & over billing) ---
under_flag = (df["ratio"] < 0.85).astype(int)
over_flag = (df["ratio"] > 1.3).astype(int)
df["rule_flag"] = under_flag | over_flag

# --- Penalize rule-based issues mildly since normalized ---
# --- Penalize rule-based issues mildly since normalized ---
rule_scaled = MinMaxScaler().fit_transform(df[["rule_flag"]]).ravel()  # ✅ flatten to 1D

df["final_score"] = (
    0.7 * df["combined_score"]
    + 0.3 * rule_scaled
    - df["rule_flag"] * 0.2
)



# --------- Deep Hybrid Meta Model (Supervised layer) ---------
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import f1_score, precision_score, recall_score

meta_features = df[["iso_score", "lof_score", "rule_flag"]]
y = df["is_synthetic"].astype(int)  # 1 = synthetic anomaly

X_train, X_test, y_train, y_test = train_test_split(meta_features, y, test_size=0.3, random_state=42)
meta_model = RandomForestClassifier(n_estimators=100, random_state=42)
meta_model.fit(X_train, y_train)

y_pred = meta_model.predict(X_test)
f1 = f1_score(y_test, y_pred)
precision = precision_score(y_test, y_pred)
recall = recall_score(y_test, y_pred)
print(f"🤖 Meta Model — F1={f1:.3f}, P={precision:.3f}, R={recall:.3f}")

# Save meta model
joblib.dump(meta_model, os.path.join(MODEL_DIR, "meta_model.pkl"))
print("✅ Meta-model (RandomForest) saved successfully.")

# --- Label anomalies: lowest 5% as anomalies ---
threshold = df["final_score"].quantile(0.08)
# ✅ Use -1 for anomaly, 1 for normal consistently
df["anomaly_label"] = np.where(df["final_score"] < threshold, -1, 1)

# --- Persistence filter: anomaly in 2+ consecutive months ---
df["persistent_anomaly"] = (
    df.groupby("customer_id")["anomaly_label"]
    .rolling(2)
    .apply(lambda x: (x == -1).sum(), raw=True)
    .reset_index(0, drop=True)
    .ge(2)
    .astype(int)
)

# --------- Step 6: Save Outputs ---------
# Top 50 suspicious customers (based on persistence first)
top50 = (
    df.groupby("customer_id")["persistent_anomaly"]
    .mean()
    .sort_values(ascending=False)
    .head(50)
    .reset_index()
)
top50.to_csv(os.path.join(DATA_DIR, "top50_suspicious_customers.csv"), index=False)

# Save Isolation Forest model
joblib.dump(iso, os.path.join(MODEL_DIR, "anomaly_model.pkl"))

# ✅ Save feature scaler (fitted on original FEATURES)
joblib.dump(feature_scaler, os.path.join(MODEL_DIR, "scaler.pkl"))

# Save processed dataset with features + synthetic anomalies
df.to_csv(os.path.join(DATA_DIR, "training_with_synthetics.csv"), index=False)
# --------- Step 7: Save Full Hybrid Components for Backend Compatibility ---------
# These additional models and scalers ensure the backend runs the *same* hybrid logic (no fallbacks).

# Save LOF model
joblib.dump(lof, os.path.join(MODEL_DIR, "lof_model.pkl"))

# Save individual scalers for each anomaly score type
iso_score_scaler = MinMaxScaler().fit(df[["iso_score"]])
lof_score_scaler = MinMaxScaler().fit(df[["lof_score"]])
meta_score_scaler = MinMaxScaler().fit(df[["final_score"]])

joblib.dump(iso_score_scaler, os.path.join(MODEL_DIR, "iso_score_scaler.pkl"))
joblib.dump(lof_score_scaler, os.path.join(MODEL_DIR, "lof_score_scaler.pkl"))
joblib.dump(meta_score_scaler, os.path.join(MODEL_DIR, "meta_score_scaler.pkl"))

print("✅ Saved LOF model and all hybrid score scalers for backend consistency.")


# --------- Logging ---------
print(f"✅ Model saved to {os.path.join(MODEL_DIR, 'anomaly_model.pkl')}")
print(f"✅ Scaler saved to {os.path.join(MODEL_DIR, 'scaler.pkl')}")
print(f"✅ Top 50 suspicious customers saved to {os.path.join(DATA_DIR, 'top50_suspicious_customers.csv')}")
print(f"✅ Training dataset with synthetics saved to {os.path.join(DATA_DIR, 'training_with_synthetics.csv')}")
print(f"⚡ Injected {df['is_synthetic'].sum()} synthetic anomalies for training.")
print("✅ Improved anomaly logic: normalized, under+over billing handled, persistence check added.")
