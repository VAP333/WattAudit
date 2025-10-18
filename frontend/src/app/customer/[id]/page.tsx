"use client";

import "@/i18n/client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { getCustomer } from "@/lib/api";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import CopilotInner from "@/components/CopilotInner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const summaryCache: Record<string, Record<string, string>> = {};

interface RecordData {
  month: string;
  consumption_kwh: number;
  billed_kwh: number;
  anomaly_score?: number;
  anomaly_label?: number;
}

interface CustomerResponse {
  customer_id: string;
  profile?: Record<string, any>;
  records: RecordData[];
  summary?: { english?: string; hindi?: string; marathi?: string };
  error?: string;
}

export default function CustomerDetail() {
  const params = useParams();
  const id = params?.id as string;
  const { t, i18n } = useTranslation();

  const [cust, setCust] = useState<CustomerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState("");
  const [loadingAI, setLoadingAI] = useState(true);

  // ✨ Inline styles
  const InlineStyles = (
    <style>{`
      @keyframes vivid-shimmer {
        0% { background-position: -250% 0; }
        100% { background-position: 250% 0; }
      }
      .shimmer-rect {
        background: linear-gradient(
          90deg,
          rgba(216, 180, 254, 0.25) 0%,
          rgba(232, 121, 249, 0.35) 50%,
          rgba(216, 180, 254, 0.25) 100%
        );
        background-size: 300% 100%;
        animation: vivid-shimmer 5s ease-in-out infinite;
        border-radius: 12px;
      }
      .panel-card {
        border: 1px solid rgba(168, 85, 247, 0.15);
        box-shadow: 0 0 20px rgba(168, 85, 247, 0.08);
        background-color: rgba(255, 255, 255, 0.9);
        border-radius: 12px;
        transition: all 0.3s ease;
      }
      .dark .panel-card {
        background-color: rgba(12, 8, 22, 0.75);
        box-shadow: 0 0 14px rgba(168,85,247,0.08);
      }
    `}</style>
  );

  // 🔹 Fetch customer data
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const r = await getCustomer(id);
        setCust(r);
      } catch (err) {
        console.error("Failed to fetch customer:", err);
        setCust({
          customer_id: id,
          records: [],
          error: "Unable to load customer data.",
        });
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // 🔹 Generate AI summary (fresh + cached per language)
  useEffect(() => {
    if (!cust) return;

    const lang = i18n.language.startsWith("hi")
      ? "hindi"
      : i18n.language.startsWith("mr")
      ? "marathi"
      : "english";

    if (summaryCache[cust.customer_id]?.[lang]) {
      setAiSummary(summaryCache[cust.customer_id][lang]);
      setLoadingAI(false);
      return;
    }

    (async () => {
      setLoadingAI(true);
      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `
Write a detailed, narrative-style report for customer ${cust.customer_id} in ${lang}.
Summarize monthly consumption and billing trends, anomaly behavior, and seasonal patterns.
Discuss billing efficiency, highlight any irregularities, and provide likely causes (e.g., under-billing, load variation, meter fault).
Write like a professional AI auditor explaining insights to an analyst.Bold important points.
`,
            lang,
            context: cust,
            customer_id: cust.customer_id,   // ✅ added
        records: cust.records,           // ✅ added for context
        ai_summary: cust.summary,  
          }),
        });

        const text = await res.text();
        summaryCache[cust.customer_id] = {
          ...summaryCache[cust.customer_id],
          [lang]: text,
        };
        setAiSummary(text);
      } catch (err) {
        console.error("AI summary generation failed:", err);
        setAiSummary(t("no_summary") || "No summary available.");
      } finally {
        setLoadingAI(false);
      }
    })();
  }, [cust, i18n.language]);

  // 🧮 Data processing
  const parsedRecords = useMemo(() => {
    return (
      cust?.records
        ?.map((r) => {
          const monthDate = new Date(r.month);
          return {
            ...r,
            monthLabel: monthDate.toLocaleDateString(),
            consumption: Number(r.consumption_kwh ?? 0),
            billed: Number(r.billed_kwh ?? 0),
            ratio:
              Number(r.consumption_kwh ?? 0) > 0
                ? Number(r.billed_kwh) / Number(r.consumption_kwh)
                : 0,
          };
        })
        .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime()) ?? []
    );
  }, [cust]);

  const anomalyCounts = useMemo(() => {
    const anomalous = parsedRecords.filter((r) => r.anomaly_label === -1).length;
    const normal = parsedRecords.length - anomalous;
    return [
      { name: t("status.anomalous") || "Anomalous", value: anomalous },
      { name: t("status.normal") || "Normal", value: normal },
    ];
  }, [parsedRecords, t]);

  const profile = cust?.profile ?? {};
  const displayName = profile.name || cust?.customer_id;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {InlineStyles}
        <div className="w-80 h-40 shimmer-rect"></div>
      </div>
    );
  }

  if (!cust || cust.error || !parsedRecords.length) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center p-6 text-red-600">
        {InlineStyles}
        <h2 className="text-xl font-semibold mb-2">{t("no_data") || "No Data"}</h2>
        <p>{cust?.error || "No records found for this customer."}</p>
        <a href="/" className="mt-4 text-sm text-purple-600 underline hover:text-purple-800">
          ← {t("back_dashboard") || "Back to Dashboard"}
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-8 px-4 md:px-8 lg:px-12 text-gray-900 dark:text-gray-100">
      {InlineStyles}

      {/* 🌟 Summary */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="panel-card p-6 col-span-2">
          <h2 className="text-2xl font-bold text-purple-700 dark:text-purple-300 mb-2 flex items-center gap-3">
             {displayName}
          </h2>

          <p className="text-sm opacity-70 mb-3">
            {profile.consumer_category} • {profile.district}
          </p>

          {loadingAI ? (
            <div className="shimmer-rect h-24 w-full"></div>
          ) : (
            <div className="text-sm leading-relaxed">
              <ReactMarkdown rehypePlugins={[rehypeRaw]}>{aiSummary}</ReactMarkdown>
            </div>
          )}
        </div>

        <div className="panel-card p-6 text-sm">
  <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
    {t("customer.details_title") || "Customer Details"}
  </h3>
  <div className="space-y-1">
    <div><b>{t("customer.id") || "ID"}:</b> {cust.customer_id}</div>
    <div><b>{t("customer.name") || "Name"}:</b> {profile.name ?? "—"}</div>
    <div>
      <b>{t("customer.category") || "Category"}:</b>{" "}
      {t(`category_labels.${profile.consumer_category?.toLowerCase()}`) ||
        profile.consumer_category ||
        "—"}
    </div>
    <div><b>{t("customer.district") || "District"}:</b> {profile.district ?? "—"}</div>
    <div><b>{t("customer.substation") || "Substation"}:</b> {profile.substation ?? "—"}</div>
    <div><b>{t("customer.install_year") || "Install Year"}:</b> {profile.install_year ?? "—"}</div>
    <div><b>{t("customer.meter_make") || "Meter Make"}:</b> {profile.meter_make ?? "—"}</div>
    {profile.phone && <div>📞 {profile.phone}</div>}
    {profile.email && <div>✉️ {profile.email}</div>}
    {profile.address && <div>📍 {profile.address}</div>}
  </div>
</div>

      </section>

      {/* 📈 Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="panel-card p-4 lg:col-span-2">
          <h4 className="font-semibold text-lg text-purple-600 dark:text-purple-300 mb-2">
            {t("chart.title") || "Consumption vs Billed (kWh)"}
          </h4>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={parsedRecords}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Line dataKey="consumption" stroke="#7c3aed" strokeWidth={2.5} dot={false} />
              <Line dataKey="billed" stroke="#ec4899" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel-card p-4">
          <h4 className="font-semibold text-lg text-purple-600 dark:text-purple-300 mb-2">
            {t("top_flagged") || "Anomaly Distribution"}
          </h4>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={anomalyCounts}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={5}
              >
                {anomalyCounts.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? "#ef4444" : "#22c55e"} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* 🧾 Detailed Table */}
      <section className="panel-card p-6 mb-8">
        <h3 className="font-semibold mb-3 text-purple-600 dark:text-purple-300 text-lg">
          {t("table.detailed_title") || "Detailed Monthly Records"}
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/75 dark:bg-[#1b1630]/60">
              <tr>
                <th className="p-3 text-left">{t("table.month")}</th>
                <th className="p-3 text-left">{t("table.consumption_kwh")}</th>
                <th className="p-3 text-left">{t("table.billed_kwh")}</th>
                <th className="p-3 text-left">{t("table.score")}</th>
                <th className="p-3 text-left">{t("table.status")}</th>
              </tr>
            </thead>
            <tbody>
              {parsedRecords.map((r, i) => (
                <tr key={i} className="border-b border-white/10">
                  <td className="p-3">{r.monthLabel}</td>
                  <td className="p-3">{r.consumption.toFixed(2)}</td>
                  <td className="p-3">{r.billed.toFixed(2)}</td>
                  <td className="p-3">{r.anomaly_score?.toFixed(3)}</td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs ${
                        r.anomaly_label === -1
                          ? "bg-red-100 text-red-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {r.anomaly_label === -1
                        ? t("status.anomalous")
                        : t("status.normal")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 🤖 Copilot */}
      <CopilotInner
        i18nLanguage={i18n.language}
        context={{
          customer_id: cust.customer_id,
          profile,
          records: cust.records,
          ai_summary: aiSummary,
        }}
      />
    </div>
  );
}
