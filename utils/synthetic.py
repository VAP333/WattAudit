import numpy as np
import pandas as pd

def inject_synthetic_anomalies_per_customer(df, customer_frac=0.1, months_frac=0.3, seed=42):
    """
    Inject synthetic anomalies at customer+month level.
    - customer_frac: fraction of customers to corrupt
    - months_frac: fraction of months per selected customer
    - seed: random seed
    Returns dataframe with 'is_synthetic' column (0/1).
    """
    np.random.seed(seed)
    df = df.copy()
    df["is_synthetic"] = 0

    customers = df["customer_id"].unique()
    n_customers = len(customers)
    k = max(1, int(n_customers * customer_frac))  # pick some customers
    chosen_customers = np.random.choice(customers, size=k, replace=False)

    for cust in chosen_customers:
        cust_mask = df["customer_id"] == cust
        cust_rows = df.loc[cust_mask]
        months = cust_rows["month"].unique()
        if len(months) == 0:
            continue
        m = max(1, int(len(months) * months_frac))
        chosen_months = np.random.choice(months, size=m, replace=False)

        for mon in chosen_months:
            idx = cust_rows[cust_rows["month"] == mon].index
            if len(idx) == 0:
                continue
            i = idx[0]

            # Pick one fraud scenario
            mode = np.random.choice([
                "underbilling",   # billed far less than consumed
                "zero_consumption", # 0 consumption but billed anyway
                "spike",          # sudden huge spike
                "flatline",       # sudden drop to near zero
                "seasonal_shift"  # very different than usual pattern
            ])

            if mode == "underbilling":
                df.at[i, "billed_kwh"] = df.at[i, "billed_kwh"] * np.random.uniform(0.05, 0.4)
            elif mode == "zero_consumption":
                df.at[i, "consumption_kwh"] = 0
                df.at[i, "billed_kwh"] *= np.random.uniform(1.2, 1.5)
            elif mode == "spike":
                df.at[i, "consumption_kwh"] *= np.random.uniform(4, 10)
            elif mode == "flatline":
                df.at[i, "consumption_kwh"] *= np.random.uniform(0.0, 0.1)
            elif mode == "seasonal_shift":
                df.at[i, "consumption_kwh"] *= np.random.uniform(0.2, 0.4)
                df.at[i, "billed_kwh"] *= np.random.uniform(1.2, 1.5)

            df.at[i, "is_synthetic"] = 1

    return df
