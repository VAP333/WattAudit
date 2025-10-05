"use client";

import { useEffect, useState, useRef } from "react";
import { getCustomer } from "@/lib/api";
import { useParams } from "next/navigation";
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

interface RecordData {
  month: string;
  consumption_kwh: number;
  billed_kwh: number;
}

interface CustomerResponse {
  customer_id: string;
  records: RecordData[];
  summary?: {
    english?: string;
    hindi?: string;
    marathi?: string;
  };
  ai_analysis?: {
    confidence_score?: number;
    confidence_percent?: number;
  };
  error?: string;
}

export default function CustomerDetail() {
  const [cust, setCust] = useState<CustomerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const params = useParams();
  const id = params?.id as string;
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const r = await getCustomer(id);
      setCust(r);
      setLoading(false);
    })();
  }, [id]);

  if (loading)
    return (
      <div className="p-6 animate-pulse text-gray-600 dark:text-gray-300">
        Loading insights...
      </div>
    );

  if (!cust || cust.error)
    return <div className="p-6 text-red-500">No data: {cust?.error}</div>;

  const chartData = cust.records.map((r: RecordData) => ({
    name: new Date(r.month).toLocaleDateString(),
    consumption: r.consumption_kwh,
    billed: r.billed_kwh,
  }));

  const confidenceRaw =
    cust.ai_analysis?.confidence_score ??
    cust.ai_analysis?.confidence_percent ??
    0;

  const confidenceText =
    confidenceRaw >= 80
      ? "High reliability — pattern is stable."
      : confidenceRaw >= 60
      ? "Moderate confidence — minor variations detected."
      : "Low confidence — irregular usage pattern.";

  const barColor =
    confidenceRaw >= 80
      ? "from-green-400 to-green-600"
      : confidenceRaw >= 60
      ? "from-yellow-400 to-yellow-600"
      : "from-red-400 to-red-600";

  return (
    <div className="p-6 min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950 transition-colors duration-500">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
          ⚡ Customer{" "}
          <span className="text-blue-600 dark:text-blue-400">
            {cust.customer_id}
          </span>
        </h2>
      </div>

      <div ref={reportRef} className="space-y-6">
        {/* Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
          <h3 className="font-semibold text-xl mb-3 text-blue-600 dark:text-blue-400">
            Explainable AI Summary
          </h3>
          <p className="mb-3 leading-relaxed">
            <strong>English:</strong> {cust.summary?.english}
          </p>
          <p className="mb-2 text-gray-700 dark:text-gray-300">
            <strong>हिन्दी:</strong> {cust.summary?.hindi}
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>मराठी:</strong> {cust.summary?.marathi}
          </p>
        </div>

        {/* Confidence Insights */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-600 rounded-xl shadow-sm p-6">
          <h3 className="font-semibold text-blue-700 dark:text-blue-400 mb-3 text-lg">
            AI Confidence Insights
          </h3>
          <p className="text-sm sm:text-base mb-2 sm:mb-0">
            <strong>Confidence Score:</strong>{" "}
            <span className="font-medium">{confidenceRaw.toFixed(2)}%</span> —{" "}
            {confidenceText}
          </p>

          {/* Confidence Bar */}
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 mt-4 overflow-hidden">
            <div
              className={`h-3 bg-gradient-to-r ${barColor} rounded-full transition-all duration-700`}
              style={{ width: `${confidenceRaw}%` }}
            ></div>
          </div>
        </div>

        {/* Chart */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg">
          <h3 className="font-semibold mb-3 text-lg">
            Consumption vs Billing Trend
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 60, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }}>
                <Label value="Month" offset={-10} position="insideBottom" />
              </XAxis>
              <YAxis tick={{ fontSize: 12 }}>
                <Label
                  value="Energy (kWh)"
                  angle={-90}
                  position="insideLeft"
                  offset={-50}
                  style={{ textAnchor: "middle" }}
                />
              </YAxis>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  borderRadius: "8px",
                  border: "1px solid #ddd",
                }}
              />
              <Line
                dataKey="consumption"
                stroke="#10B981"
                strokeWidth={2.5}
                dot={false}
                name="Consumption (kWh)"
              />
              <Line
                dataKey="billed"
                stroke="#6366F1"
                strokeWidth={2.5}
                dot={false}
                name="Billed (kWh)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Records */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md">
          <h3 className="font-semibold mb-3 text-lg">
            Detailed Monthly Records
          </h3>
          <div className="overflow-auto rounded-lg border dark:border-gray-700">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                <tr>
                  <th className="p-2 text-left">Month</th>
                  <th className="p-2 text-left">Consumption (kWh)</th>
                  <th className="p-2 text-left">Billed (kWh)</th>
                </tr>
              </thead>
              <tbody>
                {cust.records.map((r: RecordData, i: number) => (
                  <tr
                    key={i}
                    className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900 transition"
                  >
                    <td className="p-2">
                      {new Date(r.month).toLocaleDateString()}
                    </td>
                    <td className="p-2">{r.consumption_kwh}</td>
                    <td className="p-2">{r.billed_kwh.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
