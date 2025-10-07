"use client";
import "@/i18n/client"; // must be first for i18n client

// Global window typing for SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import DarkToggle from "@/components/DarkToggle";
import { getCustomers, getLive, predict } from "@/lib/api";
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

type Customer = {
  customer_id: string;
  consumer_category: string;
  avg_anomaly_score: number;
  ratio: number;
  monthly_change: number;
  consumption_kwh: number;
  anomaly_label?: number;
  top_reason?: string;
};

type LiveRecord = { customer_id: string; month: string; consumption_kwh: number; billed_kwh: number };

export default function Page(): React.ReactElement {
  const { t, i18n } = useTranslation();

  // Dashboard state
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

  // Predict
  const [predictInput, setPredictInput] = useState({ consumption: 0, billed: 0, category: "Residential" });
  const [predictResult, setPredictResult] = useState<any>(null);

  // Copilot state
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotMessages, setCopilotMessages] = useState<{ role: "user" | "bot"; text: string }[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // Refs for recognition + audio queue
  const recognitionRef = useRef<any>(null);
  const audioQueueRef = useRef<HTMLAudioElement[]>([]);
  const isPlayingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [copilotMessages, isThinking]);

  const langMap: Record<string, string> = { en: "en-US", hi: "hi-IN", mr: "mr-IN" };
  const getLocale = useCallback(() => langMap[i18n.language] || "en-US", [i18n.language]);

  // ---- Voice recognition ----
  const startRecognition = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return alert(t("voice.unsupported"));
    try {
      recognitionRef.current?.abort?.();
    } catch {}
    const r = new SR();
    r.lang = getLocale();
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onstart = () => setIsListening(true);
    r.onresult = (ev: any) => {
      try {
        const transcript = ev.results[0][0].transcript;
        setCopilotInput(transcript);
      } catch {}
      setIsListening(false);
    };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    try {
      r.start();
      recognitionRef.current = r;
    } catch (err) {
      console.warn("SR start failed", err);
    }
  }, [getLocale, t]);

  const stopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.stop?.();
    } catch {}
    setIsListening(false);
  }, []);

  const toggleVoice = useCallback(() => {
    if (isListening) stopRecognition();
    else startRecognition();
  }, [isListening, startRecognition, stopRecognition]);

  // ---- TTS queue ----
  const cleanText = (s: string) => s.replace(/[*_#`~>]/g, "").replace(/\s{2,}/g, " ").replace(/\[(.*?)\]\(.*?\)/g, "$1").trim();

  const enqueueAudio = async (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    audioQueueRef.current.push(a);

    const playNext = () => {
      if (isPlayingRef.current) return;
      const next = audioQueueRef.current.shift();
      if (!next) return;
      isPlayingRef.current = true;
      audioRef.current = next;
      next.onended = () => {
        try {
          URL.revokeObjectURL(next.src);
        } catch {}
        isPlayingRef.current = false;
        audioRef.current = null;
        playNext();
      };
      void next.play().catch((err) => {
        console.warn("audio play failed", err);
        isPlayingRef.current = false;
        audioRef.current = null;
        playNext();
      });
    };

    playNext();
  };

  const clearAudioQueue = () => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        try {
          URL.revokeObjectURL(audioRef.current.src);
        } catch {}
        audioRef.current = null;
      }
    } catch {}
    while (audioQueueRef.current.length) {
      const a = audioQueueRef.current.shift()!;
      try {
        URL.revokeObjectURL(a.src);
      } catch {}
    }
    isPlayingRef.current = false;
  };

  const speakText = async (text: string) => {
    if (!audioEnabled) return;
    try {
      const cleaned = cleanText(text);
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: cleaned, lang: getLocale() }) });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      await enqueueAudio(blob);
    } catch (err) {
      console.error("TTS error", err);
    }
  };

  useEffect(() => {
    if (!audioEnabled) clearAudioQueue();
  }, [audioEnabled]);

  // --- Copilot streaming send ---
  const handleCopilotSend = useCallback(async () => {
    if (!copilotInput.trim()) return;
    const q = copilotInput;
    setCopilotMessages((m) => [...m, { role: "user", text: q }]);
    setCopilotInput("");
    setIsThinking(true);
    // placeholder bot message that we'll update
    setCopilotMessages((m) => [...m, { role: "bot", text: "" }]);

    try {
      const res = await fetch("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no reader");
      const dec = new TextDecoder();
      let buffer = "";
      let sentenceBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = dec.decode(value, { stream: true });
        buffer += chunk;
        sentenceBuffer += chunk;

        // Update chat text in real-time
        setCopilotMessages((msgs) => {
          const copy = [...msgs];
          const idx = copy.map((x) => x.role).lastIndexOf("bot");
          if (idx >= 0) copy[idx] = { role: "bot", text: buffer };
          return copy;
        });

        // Sentence synchronization
        const sentences = sentenceBuffer.split(/(?<=[.!?])\s+/);
        while (sentences.length > 1) {
          const sentence = sentences.shift()!.trim();
          if (audioEnabled && sentence.length > 4) {
            await speakText(sentence); // speak sentence as soon as complete
          }
        }
        sentenceBuffer = sentences.join(" ");
      }

      // After stream ends, speak leftover sentence
      if (audioEnabled && sentenceBuffer.trim().length) {
        await speakText(sentenceBuffer.trim());
      }

      setIsThinking(false);
    } catch (err) {
      console.error(err);
      setCopilotMessages((m) => [...m, { role: "bot", text: t("copilot.error") }]);
      setIsThinking(false);
    }
  }, [copilotInput, audioEnabled, getLocale, t]);

  // Data fetching
  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await getCustomers();
      if (!mounted) return;
      setCustomers(res.top_customers || []);
      setFilteredCustomers(res.top_customers || []);
      setAlerts(res.total_alerts || 0);
      setInsights(res.insights || null);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

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

  useEffect(() => {
    if (filter === "all") setFilteredCustomers(customers);
    else if (filter === "alerts") setFilteredCustomers(customers.filter((c) => c.anomaly_label === -1));
    else if (filter === "stable") setFilteredCustomers(customers.filter((c) => c.anomaly_label === 1));
  }, [filter, customers]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMessage("");
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/upload_dataset`, { method: "POST", body: form });
      const data = await r.json();
      setUploadMessage(data.message || data.error || t("upload.complete"));
    } catch (err) {
      setUploadMessage(t("upload.failed"));
    }
    setUploading(false);
  };

  const handlePredict = async () => {
    const resp = await predict({ consumption_kwh: predictInput.consumption, billed_kwh: predictInput.billed, category: predictInput.category });
    setPredictResult(resp);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCopilotOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // restart recognition if locale changed while listening
    if (recognitionRef.current && isListening) {
      try {
        recognitionRef.current?.abort?.();
      } catch {}
      startRecognition();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language]);

  const chartData = customers.slice(0, 12).map((c) => ({ name: c.customer_id, score: c.avg_anomaly_score }));

  return (
    <div className="min-h-screen p-6 space-y-6">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-bold flex gap-2 items-center">
          ⚡ {t("app.title")} <span className="text-blue-500">{t("app.subtitle")}</span>
        </h1>
        <div className="flex gap-3 items-center">
          <button onClick={() => location.reload()} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
            {t("button.refresh")}
          </button>
          <DarkToggle />
        </div>
      </header>

      <div className="bg-emerald-50 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-100 p-3 rounded shadow text-sm">📡 {t("status.live_mode")}</div>

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

      <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
        <h3 className="font-semibold mb-2">{t("upload.heading")}</h3>
        <input type="file" accept=".csv" onChange={handleUpload} disabled={uploading} />
        {uploadMessage && <p className="text-sm mt-1">{uploadMessage}</p>}
      </div>

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

        {/* Customer Table */}
        <div className="bg-white dark:bg-gray-800 rounded p-4 shadow">
          <div className="flex justify-between items-center mb-3">
            <h4 className="font-semibold">{t("table.title")}</h4>
            <div className="flex gap-2 text-sm">
              {["all", "alerts", "stable"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded transition ${
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
                  const badge =
                    c.top_reason || (anomalous ? t("badge.anomaly") : t("badge.normal"));
                  return (
                    <tr
                      key={i}
                      className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
                    >
                      <td className="p-2 text-blue-600 dark:text-blue-400 hover:underline">
                        <a href={`/customer/${c.customer_id}`} target="_blank">
                          {c.customer_id}
                        </a>
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

        <div className="bg-white dark:bg-gray-800 rounded p-4 shadow space-y-3">
          <h4 className="font-semibold">{t("predict.title")}</h4>
        <div className="flex flex-col md:flex-row gap-2">
          <input type="number" placeholder={t("predict.consumption")} value={predictInput.consumption} onChange={(e) => setPredictInput({ ...predictInput, consumption: Number(e.target.value) })} className="border rounded p-2 w-full md:w-auto" />
          <input type="number" placeholder={t("predict.billed")} value={predictInput.billed} onChange={(e) => setPredictInput({ ...predictInput, billed: Number(e.target.value) })} className="border rounded p-2 w-full md:w-auto" />
          <select value={predictInput.category} onChange={(e) => setPredictInput({ ...predictInput, category: e.target.value })} className="border rounded p-2">
            <option>Residential</option>
            <option>Commercial</option>
            <option>Industrial</option>
          </select>
          <button onClick={handlePredict} className="px-3 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">{t("predict.button")}</button>
        </div>
        {predictResult && <pre className="bg-gray-100 dark:bg-gray-900 p-2 rounded text-xs overflow-auto">{JSON.stringify(predictResult, null, 2)}</pre>}
      </div>

      <button onClick={() => setCopilotOpen((s) => !s)} className={`fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl text-3xl transition-all duration-300 z-50 ${copilotOpen ? "bg-gradient-to-r from-pink-500 to-purple-500 scale-110" : "bg-gradient-to-r from-indigo-500 to-blue-600 hover:scale-105"} text-white`}>
        {copilotOpen ? "💬" : "🤖"}
      </button>

      {copilotOpen && (
        <div className="backdrop-blur-xl bg-white/80 dark:bg-gray-900/80 border border-white/10 shadow-2xl rounded-2xl w-[min(480px,90vw)] max-h-[75vh] flex flex-col overflow-hidden animate-fade-in transition-all fixed bottom-24 right-6 z-50">
          <div className="flex justify-between items-center px-4 py-3 bg-gradient-to-r from-indigo-500 to-blue-600 text-white">
            <div className="flex items-center gap-2 font-semibold">
              <span className="text-xl">⚡</span>
              <span>{t("copilot.title")}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setAudioEnabled((s) => !s)} title={audioEnabled ? t("copilot.audio_on") : t("copilot.audio_off")} className={`text-lg transition ${audioEnabled ? "opacity-100" : "opacity-50"}`}>🔊</button>
              <button onClick={() => setCopilotOpen(false)} className="hover:rotate-90 transition text-lg">✖</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-gray-400/40">
            {copilotMessages.map((m, idx) => (
              <div key={idx} className={`flex items-start gap-2 animate-fade-in ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "bot" && <span className="text-2xl">🤖</span>}
                <div className={`p-3 rounded-2xl shadow-sm max-w-[75%] leading-relaxed text-sm ${m.role === "user" ? "bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-br-none" : "bg-gray-100 dark:bg-gray-800 dark:text-gray-100 rounded-bl-none"}`}>
                  {m.role === "bot" ? <ReactMarkdown>{m.text}</ReactMarkdown> : m.text}
                </div>
                {m.role === "user" && <span className="text-xl">🧍</span>}
              </div>
            ))}
            {isThinking && <div className="text-xs text-gray-400 italic animate-pulse">{t("copilot.thinking")}</div>}
            {isListening && <div className="text-xs text-red-500 animate-pulse">🎙️ {t("voice.listening")}</div>}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 backdrop-blur-md">
            <textarea rows={1} value={copilotInput} onChange={(e) => setCopilotInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleCopilotSend(); } else if (e.key === "Enter" && e.shiftKey) { setCopilotInput((p) => p + "\n"); } }} placeholder={t("copilot.placeholder")} className="flex-1 p-2 rounded-xl border dark:bg-gray-800 resize-none text-sm focus:ring-2 focus:ring-blue-500 transition" />
            <button onClick={() => void handleCopilotSend()} className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-2 transition">➤</button>
            <button onClick={toggleVoice} className={`rounded-xl p-2 transition ${isListening ? "bg-red-500 text-white" : "bg-gray-200 dark:bg-gray-700"}`}>🎤</button>
          </div>
        </div>
      )}
    </div>
  );
}
