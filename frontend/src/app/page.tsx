"use client";
import "@/i18n/client";  // 👈 This MUST come before useTranslation

// 👇 Add these global declarations to fix TS errors
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }

  interface SpeechRecognition {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    start: () => void;
    stop: () => void;
    onstart: () => void;
    onresult: (event: SpeechRecognitionEvent) => void;
    onerror: () => void;
    onend: () => void;
  }
}

// TS helper for onresult



import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { getCustomers, getLive, predict } from "@/lib/api";
import DarkToggle from "@/components/DarkToggle";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Label,
} from "recharts";
import { useTranslation } from "react-i18next";

// Types
interface Customer {
  customer_id: string;
  consumer_category: string;
  avg_anomaly_score: number;
  ratio: number;
  monthly_change: number;
  consumption_kwh: number;
  anomaly_label?: number;
  top_reason?: string;
}

interface LiveRecord {
  customer_id: string;
  month: string;
  consumption_kwh: number;
  billed_kwh: number;
}

// Fix for TS
type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList;
};

export default function Page() {
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const { t, i18n } = useTranslation();

  // Dashboard States
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [filter, setFilter] = useState("all");
  const [live, setLive] = useState<LiveRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [alerts, setAlerts] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [insights, setInsights] = useState<any>(null);
  const [predictInput, setPredictInput] = useState({
    consumption: 0,
    billed: 0,
    category: "Residential",
  });
  const [predictResult, setPredictResult] = useState<any>(null);

  // Copilot States
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotMessages, setCopilotMessages] = useState<
    { role: "user" | "bot"; text: string }[]
  >([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(false);
   useEffect(() => {
    if ("speechSynthesis" in window) {
      speechSynthesis.onvoiceschanged = () => {
        speechSynthesis.getVoices();
      };
    }
  }, []);

  // 🎤 Voice Recognition Toggle
  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(t("voice.unsupported"));
      return;
    }
    


    const recognition = new SpeechRecognition();
    recognition.lang = "mr-IN"; // or "hi-IN" or "en-US"
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0][0].transcript;
      setCopilotInput(transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.start();
    recognitionRef.current = recognition;
  };
  // 🌐 Detect language by checking characters
const detectLang = (text: string): string => {
  // Devanagari script used for Marathi / Hindi
  if (/[ऀ-ॿ]/.test(text)) return "hi-IN"; 
  // Basic English check
  if (/[a-zA-Z]/.test(text)) return "en-US"; 
  // Fallback
  return "en-US";
};

// 🗣️ Speak response aloud using browser TTS
const speakText = (text: string, lang: string) => {
  if (!("speechSynthesis" in window)) {
    console.warn("❌ Speech Synthesis not supported in this browser.");
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1;
  utterance.pitch = 1;

  // Try to pick a voice that matches
  const voices = speechSynthesis.getVoices();
  const matchedVoice = voices.find((v) => v.lang === lang);
  if (matchedVoice) utterance.voice = matchedVoice;

  speechSynthesis.speak(utterance);
};

  

  // 🤖 Copilot Send
 const handleCopilotSend = async () => {
  if (!copilotInput.trim()) return;
  const query = copilotInput;
  setCopilotMessages((msgs) => [...msgs, { role: "user", text: query }]);
  setCopilotInput("");
  setIsThinking(true);

  const newMsgIndex = copilotMessages.length;
  setCopilotMessages((msgs) => [...msgs, { role: "bot", text: "" }]);

  try {
    const res = await fetch("/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
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
        updated[newMsgIndex] = { role: "bot", text: buffer };
        return updated;
      });
    }
    const lang = detectLang(buffer);
    if (audioEnabled) {
      speakText(buffer, lang);
    }

    setIsThinking(false);
  } catch (err) {
    console.error("❌ Copilot stream error:", err);
    setCopilotMessages((msgs) => [
      ...msgs,
      { role: "bot", text: t("copilot.error") },
    ]);
  }

  setIsThinking(false);
};


  // 📊 Fetch Data
  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await getCustomers();
      if (mounted) {
        setCustomers(res.top_customers || []);
        setFilteredCustomers(res.top_customers || []);
        setAlerts(res.total_alerts || 0);
        setInsights(res.insights || null);
      }
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // 🔄 Live polling
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

  // Filter logic
  useEffect(() => {
    if (filter === "all") setFilteredCustomers(customers);
    else if (filter === "alerts")
      setFilteredCustomers(customers.filter((c) => c.anomaly_label === -1));
    else if (filter === "stable")
      setFilteredCustomers(customers.filter((c) => c.anomaly_label === 1));
  }, [filter, customers]);

  // File Upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMessage("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/upload_dataset`,
        {
          method: "POST",
          body: formData,
        }
      );
      const data = await res.json();
      setUploadMessage(data.message || data.error || t("upload.complete"));
    } catch {
      setUploadMessage(t("upload.failed"));
    }
    setUploading(false);
  };

  // Quick Predict
  const handlePredict = async () => {
    const resp = await predict({
      consumption_kwh: predictInput.consumption,
      billed_kwh: predictInput.billed,
      category: predictInput.category,
    });
    setPredictResult(resp);
  };

  if (loading) return <div className="p-6">{t("loading")}</div>;

  const chartData = customers
    .slice(0, 12)
    .map((c) => ({ name: c.customer_id, score: c.avg_anomaly_score }));

  return (
    <div className="min-h-screen p-6 space-y-6">
      {/* Header */}
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-bold flex gap-2 items-center">
          ⚡ {t("app.title")} {" "}
          <span className="text-blue-500">{t("app.subtitle")}</span>
        </h1>
        <div className="flex gap-3 items-center">
          <button
            onClick={() => location.reload()}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            {t("button.refresh")}
          </button>
          <DarkToggle />
        </div>
      </header>

      {/* Status */}
      <div className="bg-emerald-50 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-100 p-3 rounded shadow text-sm">
        📡 {t("status.live_mode")}
      </div>

      {/* Insights */}
      {insights && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
            <div className="text-sm text-gray-500">{t("insights.top_reason")}</div>
              <div className="text-xl font-semibold">{insights.top_reason}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
              <div className="text-sm text-gray-500">{t("insights.riskiest_category")}</div>
              <div className="text-xl font-semibold">{insights.riskiest_category}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
              <div className="text-sm text-gray-500">{t("insights.alerts_vs_last_week")}</div>
              <div className="text-xl font-semibold">{insights.alert_change}%</div>
          </div>
        </div>
      )}

      {/* Upload */}
      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
  <h3 className="font-semibold mb-2">{t("upload.heading")}</h3>
        <input
          type="file"
          accept=".csv"
          onChange={handleUpload}
          disabled={uploading}
        />
        {uploadMessage && <p className="text-sm mt-1">{uploadMessage}</p>}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
          <div className="text-sm text-gray-500">{t("metrics.total_customers")}</div>
          <div className="text-2xl font-bold">{customers.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
          <div className="text-sm text-gray-500">{t("metrics.ai_alerts")}</div>
          <div className="text-2xl font-bold text-red-500">{alerts}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-4 rounded shadow">
          <div className="text-sm text-gray-500">{t("metrics.data_source")}</div>
          <div className="text-2xl font-bold">{t("metrics.data_source_value")}</div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
        <h3 className="font-semibold mb-3">{t("chart.title")}</h3>
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name">
                <Label value={t("chart.customer_id")} offset={-5} position="insideBottom" />
              </XAxis>
              <YAxis>
                <Label value={t("chart.score")} angle={-90} position="insideLeft" />
              </YAxis>
              <Tooltip />
              <Bar dataKey="score" fill="#6366F1" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
        <div className="flex justify-between items-center mb-3">
          <h4 className="font-semibold">{t("table.title")}</h4>
          <div className="flex gap-2 text-sm">
            {["all", "alerts", "stable"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded ${
                  filter === f
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-700"
                }`}
              >
                {t(`filters.${f}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 dark:bg-gray-700">
              <tr>
                <th className="p-2 text-left">{t("table.customer")}</th>
                <th className="p-2">{t("table.category")}</th>
                <th className="p-2">{t("table.score")}</th>
                <th className="p-2">{t("table.status")}</th>
                <th className="p-2">{t("table.badge")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.slice(0, 50).map((c, i) => {
                const anomalous =
                  c.anomaly_label === -1 || c.avg_anomaly_score < -0.05;
                const badge = c.top_reason || (anomalous ? t("badge.anomaly") : t("badge.normal"));
                return (
                  <tr
                    key={i}
                    className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
                  >
                    <td className="p-2 text-blue-600 dark:text-blue-400 hover:underline">
                      <Link href={`/customer/${c.customer_id}`}>
                        {c.customer_id}
                      </Link>
                    </td>
                    <td className="p-2">{c.consumer_category}</td>
                    <td className="p-2">{c.avg_anomaly_score.toFixed(4)}</td>
                    <td
                      className={`p-2 ${
                        anomalous ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {anomalous ? t("status.anomalous") : t("status.normal")}
                    </td>
                    <td className="p-2">{badge}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Predict Widget */}
      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
        <h4 className="font-semibold mb-2">{t("predict.title")}</h4>
        <div className="flex flex-col md:flex-row gap-3 mb-3">
          <input
            type="number"
            placeholder={t("predict.placeholder_consumption")}
            value={predictInput.consumption}
            onChange={(e) =>
              setPredictInput({
                ...predictInput,
                consumption: Number(e.target.value),
              })
            }
            className="border p-2 rounded flex-1"
          />
          <input
            type="number"
            placeholder={t("predict.placeholder_billed")}
            value={predictInput.billed}
            onChange={(e) =>
              setPredictInput({
                ...predictInput,
                billed: Number(e.target.value),
              })
            }
            className="border p-2 rounded flex-1"
          />
          <button
            onClick={handlePredict}
            className="px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700"
          >
            {t("predict.button")}
          </button>
        </div>
        {predictResult && (
          <pre className="bg-gray-100 dark:bg-gray-900 p-2 rounded text-xs overflow-auto">
            {JSON.stringify(predictResult, null, 2)}
          </pre>
        )}
      </div>

      {/* Floating Copilot Arc */}
      <div className="fixed bottom-6 right-6 flex flex-col items-end space-y-2 z-50">
        {copilotOpen && (
          <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg w-[min(500px,90vw)] max-h-[75vh] flex flex-col overflow-hidden animate-fade-in">
            <div className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white p-3 font-semibold flex justify-between items-center">
              <div className="flex items-center gap-3">
                <span>⚡ {t("copilot.title")}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAudioEnabled((s) => !s)}
                  aria-pressed={audioEnabled}
                  title={audioEnabled ? t("copilot.audio_on") : t("copilot.audio_off")}
                  className={`px-2 py-1 rounded-full text-sm transition focus:outline-none focus:ring-2 focus:ring-white/50 ${
                    audioEnabled ? "bg-white/20 ring-2 ring-white" : "bg-white/10"
                  }`}
                >
                  🔊
                </button>
                <button
                  onClick={() => setCopilotOpen(false)}
                  className="text-white"
                >
                  ✖
                </button>
              </div>
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
                  {t("copilot.thinking")}
                </div>
              )}
            </div>
            <div className="p-2 flex gap-2 border-t dark:border-gray-700">
              <input
                type="text"
                value={copilotInput}
                onChange={(e) => setCopilotInput(e.target.value)}
                placeholder={t("copilot.placeholder", { lng: i18n.language })}
                className="flex-1 p-2 rounded border dark:bg-gray-800"
              />
              <button
                onClick={handleCopilotSend}
                className="px-2 bg-emerald-600 text-white rounded"
              >
                ➤
              </button>
              <button
                disabled={isListening}
                onClick={toggleVoice}
                className={`px-2 rounded ${
                  isListening
                    ? "bg-red-500 text-white"
                    : "bg-gray-200 dark:bg-gray-700"
                }`}
              >
                🎤
              </button>
            </div>
          </div>
        )}

        {/* Arc Button */}
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
