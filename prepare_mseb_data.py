"""
Prepares raw MSEB billing/consumption data into the format
required by our anomaly detection pipeline.
"""

import os
import pandas as pd

# -------- Paths --------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DATA = os.path.join(BASE_DIR, "mseb_raw.csv")     # <-- Replace with real file from MSEB
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

OUTPUT_FILE = os.path.join(DATA_DIR, "dummy_billing_dataset.csv")

# -------- Column Mapping --------
COLUMN_MAP = {
    "ConsumerID": "customer_id",
    "BillMonth": "month",
    "UnitsConsumed": "consumption_kwh",
    "UnitsBilled": "billed_kwh",
    "Category": "consumer_category",
}

# -------- Load & Clean --------
def prepare_data():
    if not os.path.exists(RAW_DATA):
        raise FileNotFoundError(f"❌ Raw MSEB file not found at {RAW_DATA}")

    # Read with BOM handling
    df = pd.read_csv(RAW_DATA, encoding="utf-8-sig", sep=",")


    # Debug: show raw headers
    print("🔎 Raw columns before rename:", df.columns.tolist())

    # Rename columns
    df = df.rename(columns=COLUMN_MAP)

    # Debug: show after rename
    print("✅ Columns after rename:", df.columns.tolist())

    # Convert month to datetime
    if "month" not in df.columns:
        raise KeyError("❌ Column 'month' not found after renaming. Check CSV headers and COLUMN_MAP.")

    df["month"] = pd.to_datetime(df["month"], errors="coerce")

    # Drop rows with missing key values
    df = df.dropna(subset=["customer_id", "month", "consumption_kwh", "billed_kwh"])

    # Ensure correct types
    df["customer_id"] = df["customer_id"].astype(str)
    df["consumer_category"] = df["consumer_category"].astype(str)
    df["consumption_kwh"] = pd.to_numeric(df["consumption_kwh"], errors="coerce").fillna(0)
    df["billed_kwh"] = pd.to_numeric(df["billed_kwh"], errors="coerce").fillna(0)

    # Save cleaned file
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"✅ MSEB data prepared and saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    prepare_data()
