# regenerate_dummy_dataset.py
import os
import pandas as pd
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

OUTPUT_FILE = os.path.join(DATA_DIR, "dummy_billing_dataset.csv")

np.random.seed(42)

customers = [f"CUST{1000+i}" for i in range(48)]  # 48 customers
months = pd.date_range("2023-01-01", periods=6, freq="MS")  # 6 months
categories = ["Residential", "Commercial", "Industrial"]

rows = []
for cust in customers:
    category = np.random.choice(categories)
    base_consumption = np.random.randint(100, 1000)
    for m in months:
        consumption = base_consumption + np.random.randint(-50, 50)
        billed = consumption * np.random.uniform(0.9, 1.1)
        rows.append([cust, m, consumption, billed, category])

df = pd.DataFrame(rows, columns=["customer_id", "month", "consumption_kwh", "billed_kwh", "consumer_category"])

df.to_csv(OUTPUT_FILE, index=False)
print(f"✅ Restored dataset with {len(df)} rows at {OUTPUT_FILE}")
