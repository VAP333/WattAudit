import psycopg2
import pandas as pd

# --- replace this with your connection string ---

conn_string = "postgresql://neondb_owner:npg_4oOTPRchau0w@ep-solitary-leaf-a1f8glg6-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"


# --- connect to database ---
conn = psycopg2.connect(conn_string)
cur = conn.cursor()

# --- load local CSV ---
df = pd.read_csv("data/dummy_billing_dataset.csv", parse_dates=["month"])

# --- insert into Neon ---
for _, row in df.iterrows():
    cur.execute("""
        INSERT INTO billing_data (customer_id, month, consumption_kwh, billed_kwh, consumer_category)
        VALUES (%s, %s, %s, %s, %s)
    """, (
        str(row["customer_id"]),
        row["month"].date(),
        float(row["consumption_kwh"]),
        float(row["billed_kwh"]),
        str(row["consumer_category"]),
    ))

conn.commit()
cur.close()
conn.close()
print("✅ Data uploaded to Neon successfully!")
