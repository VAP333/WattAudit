"use client";

import "@/i18n/client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { getCustomer } from "@/lib/api";
import { useTranslation } from "react-i18next";
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

// language detection now handled by i18next; we'll derive a short code from i18n.language where needed

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
  const params = useParams();
  const id = params?.id as string;
  const reportRef = useRef<HTMLDivElement>(null);

  const [cust, setCust] = useState<CustomerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { t, i18n } = useTranslation();

  // derive a short language code for places that previously switched on lang
  const currentLang: "en" | "hi" | "mr" = ((): "en" | "hi" | "mr" => {
    const l = (i18n.language || "en").toLowerCase();
    if (l.startsWith("hi")) return "hi";
    if (l.startsWith("mr")) return "mr";
    return "en";
  })();

  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState<
    { role: "user" | "bot"; text: string }[]
  >([]);
  const [copilotInput, setCopilotInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const r = await getCustomer(id);
      setCust(r);
      setLoading(false);
    })();
  }, [id]);

  const handleCopilotSend = async () => {
    if (!copilotInput.trim()) return;
    const query = copilotInput;
    setCopilotMessages((msgs) => [...msgs, { role: "user", text: query }]);
    setCopilotInput("");
    setIsThinking(true);

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: `Customer ${id}: ${query}` }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        setCopilotMessages((msgs) => {
          const updated = [...msgs];
          updated[updated.length - 1] = { role: "bot", text: buffer };
          return updated;
        });
      }
    } catch (err) {
      console.error("Copilot error:", err);
      setCopilotMessages((msgs) => [
        ...msgs,
        { role: "bot", text: "⚠️ Error getting response" },
      ]);
    }

    setIsThinking(false);
  };

  if (loading) {
    return (
      <div className="p-6 animate-pulse text-gray-600 dark:text-gray-300">
        {t("loading_insights")}
      </div>
    );
  }

  if (!cust || cust.error) {
    return (
      <div className="p-6 text-red-500">
        {t("no_data")}: {cust?.error}
      </div>
    );
  }

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
      ? t("confidence.high", { lng: i18n.language })
      : confidenceRaw >= 60
      ? t("confidence.medium", { lng: i18n.language })
      : t("confidence.low", { lng: i18n.language });

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
          ⚡ {t("customer_title")} —{" "}
          <span className="text-blue-600 dark:text-blue-400">
            {cust.customer_id}
          </span>
        </h2>
      </div>

      <div ref={reportRef} className="space-y-6">
        {/* Summary */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border-l-4 border-blue-500">
          <h3 className="font-semibold text-xl mb-3 text-blue-600 dark:text-blue-400">
            {t("explainable_ai_summary")}
          </h3>
          <p className="mb-3 leading-relaxed">
            <strong>{t("label_english")}:</strong> {cust.summary?.english}
          </p>
          <p className="mb-2 text-gray-700 dark:text-gray-300">
            <strong>{t("label_hindi")}:</strong> {cust.summary?.hindi}
          </p>
          <p className="text-gray-700 dark:text-gray-300">
            <strong>{t("label_marathi")}:</strong> {cust.summary?.marathi}
          </p>
        </div>

        {/* Confidence */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-600 rounded-xl shadow-sm p-6">
          <h3 className="font-semibold text-blue-700 dark:text-blue-400 mb-3 text-lg">
            {t("ai_confidence_insights")}
          </h3>
          <p className="text-sm sm:text-base mb-2 sm:mb-0">
            <strong>{t("confidence_score")}:</strong>{" "}
            <span className="font-medium">{confidenceRaw.toFixed(2)}%</span> —{" "}
            {confidenceText}
          </p>
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
            {t("chart.title", { lng: i18n.language })}
          </h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 60, bottom: 40 }}
            >
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 12 }}>
                <Label
                  value={t("label.month", { lng: i18n.language })}
                  offset={-10}
                  position="insideBottom"
                />
              </XAxis>
              <YAxis tick={{ fontSize: 12 }}>
                <Label
                  value={t("label.kwh")}
                  angle={-90}
                  position="insideLeft"
                  offset={-50}
                  style={{ textAnchor: "middle" }}
                />
              </YAxis>
              <Tooltip />
              <Line
                dataKey="consumption"
                stroke="#10B981"
                strokeWidth={2.5}
                dot={false}
                name={t("chart.consumption", { lng: i18n.language })}
              />
              <Line
                dataKey="billed"
                stroke="#6366F1"
                strokeWidth={2.5}
                dot={false}
                name={t("chart.billed", { lng: i18n.language })}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-md">
          <h3 className="font-semibold mb-3 text-lg">
            {t("table.detailed_title", { lng: i18n.language })}
          </h3>
          <div className="overflow-auto rounded-lg border dark:border-gray-700">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                <tr>
                  <th className="p-2 text-left">{t("table.month")}</th>
                  <th className="p-2 text-left">{t("table.consumption_kwh")}</th>
                  <th className="p-2 text-left">{t("table.billed_kwh")}</th>
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

      {/* Copilot */}
      <div className="fixed bottom-6 right-6 flex flex-col items-end space-y-2 z-50">
        {copilotOpen && (
          <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg w-80 max-h-[60vh] flex flex-col overflow-hidden animate-fade-in">
            <div className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white p-3 font-semibold flex justify-between items-center">
              ⚡ WattAudit Copilot
              <button onClick={() => setCopilotOpen(false)}>✖</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {copilotMessages.map((m, idx) => (
                <div
                  key={idx}
                  className={`p-2 rounded text-sm max-w-[80%] ${
                    m.role === "user"
                      ? "bg-blue-100 dark:bg-blue-900 ml-auto"
                      : "bg-gray-100 dark:bg-gray-700 mr-auto"
                  }`}
                >
                  {m.text}
                </div>
              ))}
              {isThinking && (
                <div className="text-xs text-gray-400 animate-pulse">
                  Copilot is thinking...
                </div>
              )}
            </div>
            <div className="p-2 flex gap-2 border-t dark:border-gray-700">
              <input
                type="text"
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                placeholder="Ask in English / हिंदी / मराठी..."
                className="flex-1 p-2 rounded border dark:bg-gray-800"
              />
              <button
                onClick={handleCopilotSend}
                className="px-2 bg-emerald-600 text-white rounded"
              >
                ➤
              </button>
            </div>
          </div>
        )}

        <button
          onClick={() => setCopilotOpen(!copilotOpen)}
          className="relative w-14 h-14 bg-gradient-to-r from-indigo-500 to-blue-500 rounded-full shadow-lg flex items-center justify-center text-white text-2xl animate-glow"
        >
          🤖
          <span className="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-400 to-blue-400 blur opacity-75 animate-pulse" />
        </button>
      </div>
    </div>
  );
}
