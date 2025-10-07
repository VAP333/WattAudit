"use client";

import "@/i18n/client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { getCustomer } from "@/lib/api";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
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

// Global SpeechRecognition
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
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

  // voice / recognition states
  const [isListening, setIsListening] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // --- TTS setup ---
  const audioQueueRef = useRef<HTMLAudioElement[]>([]);
  const isPlayingRef = useRef(false);

  const cleanText = (s: string) =>
    s.replace(/[*_#`~>]/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\[(.*?)\]\(.*?\)/g, "$1")
      .trim();

  const clearAudioQueue = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      try {
        URL.revokeObjectURL(audioRef.current.src);
      } catch {}
      audioRef.current = null;
    }
    while (audioQueueRef.current.length) {
      const a = audioQueueRef.current.shift()!;
      try {
        URL.revokeObjectURL(a.src);
      } catch {}
    }
    isPlayingRef.current = false;
  };

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
      void next.play().catch(() => {
        isPlayingRef.current = false;
        audioRef.current = null;
        playNext();
      });
    };

    playNext();
  };

  // play TTS directly (after full response) — uses audioRef for pause/cleanup
  const speakText = async (text: string) => {
    if (!audioEnabled || !text.trim()) return;
    try {
      const cleaned = cleanText(text);
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleaned, lang: i18n.language }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      await audio.play();
    } catch (err) {
      console.warn("TTS error:", err);
    }
  };

  const clearAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      try { URL.revokeObjectURL(audioRef.current.src); } catch {}
      audioRef.current = null;
    }
  }, []);

  // language mapping for SpeechRecognition / TTS locale
  const langMap: Record<string, string> = { en: "en-US", hi: "hi-IN", mr: "mr-IN" };
  const getLocale = useCallback(() => langMap[i18n.language] || "en-US", [i18n.language]);

  // SpeechRecognition helpers
  const startRecognition = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return alert(t("voice.unsupported"));
    try { recognitionRef.current?.abort?.(); } catch {}
    const r = new SR();
    r.lang = getLocale();
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onstart = () => setIsListening(true);
    r.onresult = (ev: any) => {
      const transcript = ev.results[0][0].transcript;
      setCopilotInput(transcript);
      setIsListening(false);
    };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    try { r.start(); recognitionRef.current = r; } catch (err) {
      console.warn("SR start failed", err);
    }
  }, [getLocale, t]);

  const stopRecognition = useCallback(() => {
    try { recognitionRef.current?.stop?.(); } catch {}
    setIsListening(false);
  }, []);

  const toggleVoice = useCallback(() => {
    if (isListening) stopRecognition();
    else startRecognition();
  }, [isListening, startRecognition, stopRecognition]);

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
    const q = copilotInput;
    setCopilotMessages((m) => [...m, { role: "user", text: q }]);
    setCopilotInput("");
    setIsThinking(true);
    setCopilotMessages((m) => [...m, { role: "bot", text: "" }]);

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          lang: i18n.language, // ensure the model replies in the selected language
          customer_id: id,
          summary: cust?.summary,
          recent_data: cust?.records.slice(-6),
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("no reader");

      const dec = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        buffer += chunk;

        setCopilotMessages((msgs) => {
          const copy = [...msgs];
          const idx = copy.map((x) => x.role).lastIndexOf("bot");
          if (idx >= 0) copy[idx] = { role: "bot", text: buffer };
          return copy;
        });
      }

      if (audioEnabled && buffer.trim().length) {
        await speakText(buffer); // speak only after full message
      }

      setIsThinking(false);
    } catch (err) {
      console.error(err);
      setCopilotMessages((m) => [...m, { role: "bot", text: t("copilot.error") }]);
      setIsThinking(false);
    }
  };

  useEffect(() => {
    if (!copilotOpen) clearAudio(); // stop any ongoing speech when assistant closes
    const handleVisibilityChange = () => {
      if (document.hidden) clearAudio(); // stop when tab is hidden
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [copilotOpen, clearAudio]);

  // scroll to bottom when messages update
  useEffect(() => {
    if (messagesEndRef.current)
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [copilotMessages, isThinking]);

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

      {/* Copilot Floating Assistant */}
      <button
        onClick={() => setCopilotOpen((s) => !s)}
        className={`fixed bottom-6 right-6 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl text-3xl transition-all duration-300 z-50 ${
          copilotOpen
            ? "bg-gradient-to-r from-pink-500 to-purple-500 scale-110"
            : "bg-gradient-to-r from-indigo-500 to-blue-600 hover:scale-105"
        } text-white`}
      >
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
              <button
                onClick={() => setAudioEnabled((s) => !s)}
                title={audioEnabled ? t("copilot.audio_on") : t("copilot.audio_off")}
                className={`text-lg transition ${audioEnabled ? "opacity-100" : "opacity-50"}`}
              >
                🔊
              </button>
              <button
                onClick={toggleVoice}
                className={`text-lg transition ${isListening ? "text-red-400" : "opacity-80"}`}
              >
                🎤
              </button>
              <button onClick={() => setCopilotOpen(false)} className="hover:rotate-90 transition text-lg">✖</button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-thumb-gray-400/40">
            {copilotMessages.map((m, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 animate-fade-in ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {m.role === "bot" && <span className="text-2xl">🤖</span>}
                <div
                  className={`p-3 rounded-2xl shadow-sm max-w-[75%] leading-relaxed text-sm ${
                    m.role === "user"
                      ? "bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-br-none"
                      : "bg-gray-100 dark:bg-gray-800 dark:text-gray-100 rounded-bl-none"
                  }`}
                >
                  {m.role === "bot" ? (
                    <ReactMarkdown>{m.text}</ReactMarkdown>
                  ) : (
                    m.text
                  )}
                </div>
                {m.role === "user" && <span className="text-xl">🧍</span>}
              </div>
            ))}
            {isThinking && (
              <div className="text-xs text-gray-400 italic animate-pulse">
                {t("copilot.thinking")}
              </div>
            )}
            {isListening && (
              <div className="text-xs text-red-500 animate-pulse">🎙️ {t("voice.listening")}</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 backdrop-blur-md">
            <textarea
              rows={1}
              value={copilotInput}
              onChange={(e) => setCopilotInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleCopilotSend();
                } else if (e.key === "Enter" && e.shiftKey) {
                  setCopilotInput((p) => p + "\n");
                }
              }}
              placeholder={t("copilot.placeholder")}
              className="flex-1 p-2 rounded-xl border dark:bg-gray-800 resize-none text-sm focus:ring-2 focus:ring-blue-500 transition"
            />
            <button
              onClick={() => void handleCopilotSend()}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-2 transition"
            >
              ➤
            </button>
            <button
              onClick={toggleVoice}
              className={`rounded-xl p-2 transition ${isListening ? "bg-red-500 text-white" : "bg-gray-200 dark:bg-gray-700"}`}
            >
              🎤
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
