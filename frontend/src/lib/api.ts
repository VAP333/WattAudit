// frontend/src/lib/api.ts

const API =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

export async function getCustomers() {
  const res = await fetch(`${API}/customers`);
  return res.ok ? res.json() : { error: await res.text() };
}

export async function getCustomer(id: string) {
  try {
    const res = await fetch(`${API}/customer/${id}`);

    // Handle non-OK responses early
    if (!res.ok) {
      const txt = await res.text();
      console.error("❌ API error:", txt);
      return { customer_id: id, records: [], error: txt || "API error" };
    }

    // Try to parse JSON safely
    let data: any = null;
    try {
      data = await res.json();
    } catch (err) {
      console.error("❌ Failed to parse JSON:", err);
      return { customer_id: id, records: [], error: "Invalid JSON response" };
    }

    // ✅ Normalize shape to what the frontend expects
    return {
      customer_id: data?.customer_id || id,
      records: data?.records || data?.data || data?.records_data || [],
      profile: data?.profile || null,
      summary: data?.summary || null,
      ai_analysis: data?.ai_analysis || null,
      error: data?.error,
    };
  } catch (err: any) {
    console.error("❌ getCustomer failed:", err);
    return { customer_id: id, records: [], error: err.message || "Fetch failed" };
  }
}



export async function getLive(limit = 100) {
  const res = await fetch(`${API}/customers?limit=${limit}`);
  return res.ok ? res.json() : { error: await res.text() };
}


export async function predict(payload: {
  consumption_kwh: number;
  billed_kwh: number;
  category?: string;
}) {
  const res = await fetch(`${API}/predict`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok ? res.json() : { error: await res.text() };
}
