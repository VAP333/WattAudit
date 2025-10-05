import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Read connection string
conn_string = os.getenv("NEON_CONN")

print("🧠 Testing Neon connection...")
try:
    conn = psycopg2.connect(conn_string)
    cursor = conn.cursor()
    cursor.execute("SELECT version();")
    version = cursor.fetchone()
    print(f"✅ Connected successfully! PostgreSQL version: {version[0]}")
    cursor.close()
    conn.close()
except Exception as e:
    print("❌ Connection failed:", e)
