"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCustomers, getLive, predict } from "@/lib/api";
import DarkToggle from "@/components/DarkToggle";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Label,
} from "recharts";

interface Customer {
  customer_id: string;
  consumer_category: string;
  avg_anomaly_score: number;
  ratio: number;
  monthly_change: number;
  consumption_kwh: number;
  anomaly_label?: number; // ✅ use this for correct red/green logic
}

interface LiveRecord {
  customer_id: string;
  month: string;
  consumption_kwh: number;
  billed_kwh: number;
}

export default function Page() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState("all");
  const [live, setLive] = useState<LiveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [alerts, setAlerts] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  // Fetch customers
  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await getCustomers();
      if (mounted) {
        setCustomers(res.top_customers || []);
        setFilteredCustomers(res.top_customers || []);
        setAlerts(res.total_alerts || 0);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Live data polling
  useEffect(() => {
    let timer: NodeJS.Timeout;
    const fetchLive = async () => {
      const r = await getLive(100);
      if (Array.isArray(r)) setLive(r);
    };
    fetchLive();
    if (autoRefresh) timer = setInterval(fetchLive, 5000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  // Apply filter
  useEffect(() => {
    if (filter === "all") setFilteredCustomers(customers);
    else if (filter === "alerts")
      setFilteredCustomers(customers.filter((c) => c.anomaly_label === -1));
    else if (filter === "stable")
      setFilteredCustomers(customers.filter((c) => c.anomaly_label === 1));
  }, [filter, customers]);

  const chartData = customers
    .slice(0, 12)
    .map((c) => ({ name: c.customer_id, score: c.avg_anomaly_score }));

  // Predict handler
  const runPredict = async () => {
    const resp = await predict({
      consumption_kwh: 300,
      billed_kwh: 250,
      category: "Residential",
    });
    alert(JSON.stringify(resp, null, 2));
  };

  // File upload handler
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMessage("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload_dataset`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setUploadMessage(data.message || data.error || "Upload complete.");
    } catch (err) {
      setUploadMessage("Upload failed.");
    }
    setUploading(false);
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <header className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex gap-2 items-center">
          ⚡ WattAudit++ <span className="text-blue-500">Explainable AI Dashboard</span>
        </h1>
        <div className="flex gap-3 items-center">
          <button
            onClick={() => {
              setLoading(true);
              getCustomers().then((r) => {
                setCustomers(r.top_customers || []);
                setFilteredCustomers(r.top_customers || []);
                setAlerts(r.total_alerts || 0);
                setLoading(false);
              });
            }}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Refresh
          </button>
          <DarkToggle />
        </div>
      </header>

      {/* Upload Dataset */}
      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow mb-6">
        <h3 className="font-semibold mb-2">Upload New Dataset (CSV)</h3>
        <input
          type="file"
          accept=".csv"
          onChange={handleUpload}
          disabled={uploading}
          className="mb-2"
        />
        {uploadMessage && <p className="text-sm mt-1">{uploadMessage}</p>}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
          <div className="text-sm text-gray-500 dark:text-gray-300">Total Customers</div>
          <div className="text-2xl font-bold">{customers.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
          <div className="text-sm text-gray-500 dark:text-gray-300">AI Alerts</div>
          <div className="text-2xl font-bold text-red-500">{alerts}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
          <div className="text-sm text-gray-500 dark:text-gray-300">Live Source</div>
          <div className="text-2xl font-bold">Neon + Local</div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow mb-6">
        <h3 className="font-semibold mb-3">Top Anomaly Scores (Explainable AI)</h3>
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name">
                <Label value="Customer ID" offset={-5} position="insideBottom" />
              </XAxis>
              <YAxis>
                <Label
                  value="Anomaly Score"
                  angle={-90}
                  offset={-5}
                  position="insideLeft"
                />
              </YAxis>
              <Tooltip />
              <Line dataKey="score" stroke="#6366F1" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Customer Table */}
      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow mb-6">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-semibold">Customer Insights</h4>
          <div className="flex gap-2 text-sm">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1 rounded ${
                filter === "all" ? "bg-blue-600 text-white" : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter("alerts")}
              className={`px-3 py-1 rounded ${
                filter === "alerts" ? "bg-red-600 text-white" : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              Alerts
            </button>
            <button
              onClick={() => setFilter("stable")}
              className={`px-3 py-1 rounded ${
                filter === "stable" ? "bg-green-600 text-white" : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              Stable
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-700">
              <tr>
                <th className="p-2 text-left">Customer ID</th>
                <th className="p-2 text-left">Category</th>
                <th className="p-2 text-left">Score</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.slice(0, 50).map((c, idx) => {
                const isAnomalous =
                  c.anomaly_label === -1 || c.avg_anomaly_score < -0.05;
                const statusClass = isAnomalous
                  ? "text-red-600 bg-red-100 dark:bg-red-900/40"
                  : "text-green-600 bg-green-100 dark:bg-green-900/40";
                const statusText = isAnomalous ? "⚠️ Anomalous" : "✅ Normal";

                return (
                  <tr
                    key={idx}
                    className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900 transition"
                  >
                    <td className="p-2 text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">
                      <Link href={`/customer/${c.customer_id}`}>
                        {c.customer_id}
                      </Link>
                    </td>
                    <td className="p-2">{c.consumer_category}</td>
                    <td className="p-2">
                      {Number(c.avg_anomaly_score).toFixed(4)}
                    </td>
                    <td className={`p-2 rounded ${statusClass} font-medium`}>
                      {statusText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Feed */}
      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-semibold">Live Feed (Latest)</h4>
          <div className="flex gap-2 items-center">
            <label className="text-sm">Auto</label>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
          </div>
        </div>

        <div className="h-72 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-700">
              <tr>
                <th className="p-2">Customer</th>
                <th className="p-2">Month</th>
                <th className="p-2">Consumption</th>
                <th className="p-2">Billed</th>
              </tr>
            </thead>
            <tbody>
              {live.slice(0, 50).map((r, i) => (
                <tr
                  key={i}
                  className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <td className="p-2">{r.customer_id}</td>
                  <td className="p-2">
                    {new Date(r.month).toLocaleDateString()}
                  </td>
                  <td className="p-2">{r.consumption_kwh}</td>
                  <td className="p-2">{Number(r.billed_kwh).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => getLive(50).then(setLive)}
            className="px-3 py-1 bg-slate-600 text-white rounded hover:bg-slate-700 transition"
          >
            Refresh Live
          </button>
          <button
            onClick={runPredict}
            className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 transition"
          >
            Run Sample Predict
          </button>
        </div>
      </div>
    </div>
  );
}
