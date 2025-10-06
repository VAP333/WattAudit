// frontend/src/lib/api.ts
const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export async function getCustomers() {
  const res = await fetch(`${API}/customers`);
  return res.ok ? res.json() : { error: await res.text() };
}

export async function getCustomer(id: string) {
  const res = await fetch(`${API}/customer/${id}`);
  return res.ok ? res.json() : { error: await res.text() };
}

export async function getLive(limit = 100) {
  const res = await fetch(`${API}/get_data?limit=${limit}`);
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
