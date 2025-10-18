"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  RefreshCw,
  User,
  Database,
  AlertTriangle,
  Repeat,
  RotateCcw,
  Send,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import { getCustomers } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import "@/i18n/client"; // ensure i18n is initialized

// --------------------- Types ---------------------
type Customer = {
  customer_id: string;
  consumer_category: string;
  avg_anomaly_score: number;
  ratio: number;
  monthly_change: number;
  consumption_kwh: number;
  anomaly_label?: number;
  persistent_anomaly?: number;
  reason?: string;
  billing_gap?: number;
};

// --------------------- Copilot (inner component) ---------------------
function CopilotInner({ i18nLanguage }: { i18nLanguage: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [soundOn, setSoundOn] = useState(true);
  const [listening, setListening] = useState(false);

  const chatRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const interimRef = useRef<string>("");

  // Auto-scroll chat when messages change
  useEffect(() => {
    if (!open) return;
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, open]);

  // Initialize Web Speech recognition (Mic)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      recognitionRef.current = null;
      return;
    }

    // if existing, abort
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }

    const recog = new SpeechRecognition();
    // set language from i18n if available
    const lang = i18n.language || i18nLanguage || "en";
    if (lang.startsWith("hi")) recog.lang = "hi-IN";
    else if (lang.startsWith("mr")) recog.lang = "mr-IN";
    else recog.lang = "en-IN";

    recog.interimResults = true;
    recog.maxAlternatives = 1;

    recog.onstart = () => {
      setListening(true);
      interimRef.current = "";
    };
    recog.onend = () => {
      setListening(false);
      if (interimRef.current) {
        setInput((s) => (s ? s + " " + interimRef.current : interimRef.current));
        interimRef.current = "";
      }
    };
    recog.onerror = (e: any) => {
      console.warn("Speech error", e);
      setListening(false);
    };
    recog.onresult = (evt: any) => {
      let interim = "";
      let final = "";
      for (let i = evt.resultIndex; i < evt.results.length; ++i) {
        const r = evt.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) {
        setInput((s) => (s ? s + " " + final : final));
      } else {
        interimRef.current = interim;
      }
    };

    recognitionRef.current = recog;
    return () => {
      try { recog.abort(); } catch {}
      recognitionRef.current = null;
    };
  }, [i18n.language, i18nLanguage]);

  const startListening = () => {
    const r = recognitionRef.current;
    if (!r) {
      alert(t("voice.unsupported") || "Voice not supported in this browser");
      return;
    }
    try {
      r.start();
    } catch {
      try { r.abort(); r.start(); } catch {}
    }
  };
  const stopListening = () => {
    const r = recognitionRef.current;
    try { r.stop(); } catch {}
    setListening(false);
  };

  // TTS play
  const playTTS = async (text: string) => {
    if (!soundOn) return;
    try {
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch {}
        if (currentAudioUrlRef.current) URL.revokeObjectURL(currentAudioUrlRef.current);
        audioRef.current = null;
        currentAudioUrlRef.current = null;
      }
      const resp = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang: i18n.language || i18nLanguage || "en" }) });
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      currentAudioUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        try { if (currentAudioUrlRef.current) URL.revokeObjectURL(currentAudioUrlRef.current); } catch {}
        audioRef.current = null; currentAudioUrlRef.current = null;
      };
      await audio.play();
    } catch (err) {
      console.warn("TTS error", err);
    }
  };
  // stop audio if chat closed
useEffect(() => {
  if (!open && audioRef.current) {
    try {
      audioRef.current.pause();
      if (currentAudioUrlRef.current)
        URL.revokeObjectURL(currentAudioUrlRef.current);
    } catch {}
  }
}, [open]);


  const sendMessage = async (textArg?: string) => {
    const text = (textArg ?? input).trim();
    if (!text) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setIsSending(true);

    // stop any audio playing
    try {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if (currentAudioUrlRef.current) { URL.revokeObjectURL(currentAudioUrlRef.current); currentAudioUrlRef.current = null; }
    } catch {}

    try {
      const res = await fetch("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: text, lang: i18n.language || i18nLanguage || "en" }) });
      if (!res.ok) {
        const txt = await res.text();
        setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${t("copilot_err") || "Copilot error"}: ${txt}` }]);
        return;
      }

      // streaming reader if available
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      // placeholder
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          assistantText += chunk;
          setMessages((m) => {
            const cp = [...m];
            cp[cp.length - 1] = { role: "assistant", content: assistantText };
            return cp;
          });
        }
      } else {
        const full = await res.text();
        assistantText = full;
        setMessages((m) => {
          const cp = [...m];
          cp[cp.length - 1] = { role: "assistant", content: assistantText };
          return cp;
        });
      }

      if (soundOn) playTTS(assistantText);
    } catch (err) {
      console.error("Copilot send error:", err);
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${t("copilot_err") || "Copilot error — check backend."}` }]);
    } finally {
      setIsSending(false);
    }
  };

  // Copilot panel CSS: resizable edges (bounded via min/max inline styles)
  // Note: CSS 'resize' is used; user can resize from edges/corner. We keep sensible min/max.
  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen((s) => !s)}
        aria-label={t("copilot.open_copilot")}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-2xl bg-gradient-to-r from-purple-600 to-fuchsia-600"
      >
        <Bot size={22} />
      </button>

      {open && (
 <div
  ref={chatRef}
  style={{
    width: 600,
    maxHeight: 500, // stops growing after this
    height: "auto",
    transition: "height 0.3s ease, width 0.3s ease",
    overflowY: messages.length > 3 ? "auto" : "visible",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
  }}
  className="fixed bottom-24 right-6 z-[9999]
             bg-gradient-to-br from-purple-600/10 via-fuchsia-500/10 to-white/20
             dark:from-purple-900/40 dark:via-fuchsia-800/30 dark:to-transparent
             border border-purple-400/30 backdrop-blur-2xl
             rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.25)]"
>




          {/* header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white">
            <div className="flex items-center gap-2 font-semibold"><Bot size={16} /> WattAudit Copilot</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setMessages([])} title={t("copilot.clear")} className="p-1 rounded-full hover:bg-white/20"><RotateCcw size={16} /></button>
              <button onClick={() => setOpen(false)} title={t("copilot.close")} className="p-1 rounded-full hover:bg-white/20"><X size={16} /></button>
            </div>
          </div>

          {/* chat area */}
          <div style={{ maxHeight: '45vh' }} ref={chatRef} className="p-4 overflow-y-auto space-y-3 text-sm bg-transparent">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 italic">🤖 {t("start_chat") || "Start chatting with your AI Copilot..."}</div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-md ${m.role === "user" ? "ml-auto bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white" : "mr-auto bg-white/90 text-gray-900 dark:bg-[#1b1630] dark:text-gray-100 border border-white/10"}`}>
                 {m.role === "assistant" ? (
  <div className={`${isSending ? "animate-pulse text-purple-500" : ""}`}>
    <ReactMarkdown rehypePlugins={[rehypeRaw]}>{m.content}</ReactMarkdown>
  </div>
) : (
  <div>{m.content}</div>
)}

                </div>
              ))
            )}
          </div>

          {/* status / shimmer for generating or listening */}
          <div className="px-4">
            {/* vivid shimmer rectangle (shows when sending or listening) */}
            <div className="mt-3">
              {isSending && (
                <div className="w-full rounded-lg p-3 shimmer-rect text-white text-sm">
                  {t("generating_insights") || "Generating response..."}
                </div>
              )}
              {listening && (
                  <div className="mt-2 text-sm font-medium text-emerald-400 animate-pulse">
    🎤 {input || t("voice.listening") || "Listening..."}
                </div>
              )}
            </div>
          </div>

          {/* input row */}
          <form onSubmit={(e) => { e.preventDefault(); if (!isSending) sendMessage(); }} className="p-3 border-t border-white/10 bg-white/5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (listening) stopListening();
                else startListening();
              }}
              title={t("voice.start") || "Voice input"}
              className={`p-2 rounded-full ${listening ? 'bg-purple-600 text-white' : 'bg-white/10'}`}
            >
              🎤
            </button>

            <button type="button" onClick={() => setSoundOn((s) => !s)} title={soundOn ? t("playback.pause") || "Mute" : t("playback.resume") || "Unmute"} className={`p-2 rounded-full ${soundOn ? 'bg-white/10' : 'bg-white/5'}`}>
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>

            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("copilot.placeholder") || "Ask in English / Hindi / Marathi..."}
              className="flex-1 rounded-full px-4 py-2 text-sm bg-white/80 dark:bg-[#1b1630] border border-white/10 focus:outline-none focus:ring-2 focus:ring-purple-300 text-gray-900"
            />

            <button disabled={isSending} type="submit" className="p-2 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md" title={t("send") || "Send"}>
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

// --------------------- Dashboard Page (main) ---------------------
export default function DashboardPage(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filtered, setFiltered] = useState<Customer[]>([]);
  const [alerts, setAlerts] = useState(0);
  const [insights, setInsights] = useState<any>(null);
  const [insightsSummary, setInsightsSummary] = useState<string | null>(null);
  const [insightsGenerating, setInsightsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<"all" | "alerts" | "stable">("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [sortKey, setSortKey] = useState<keyof Customer | null>("avg_anomaly_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // local language state so we reload on change
  const [langState, setLangState] = useState<string>(i18n.language || (typeof window !== "undefined" ? (localStorage.getItem("lang") || "en") : "en"));
useEffect(() => {
  const saved = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
  if (saved && i18n.language !== saved) i18n.changeLanguage(saved);

  const onChange = (lng: string) => {
    setLangState(lng);
    if (typeof window !== "undefined") localStorage.setItem("lang", lng);
  };

  i18n.on("languageChanged", onChange);
  return () => i18n.off("languageChanged", onChange);
}, [i18n.language]);



  // fetch customers & compute quick insights
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await getCustomers();
        if (!mounted) return;
        const rows = res.top_customers || [];
        setCustomers(rows);
        setFiltered(rows);
        setAlerts(res.total_alerts || 0);

        if (rows.length) {
          const reasonCounts: Record<string, number> = {};
          const catScores: Record<string, number[]> = {};
          let persistentCount = 0;
          rows.forEach((r: any) => {
            const reasonKey = (r.reason || "Unknown").split("|")[0].trim();
            reasonCounts[reasonKey] = (reasonCounts[reasonKey] || 0) + 1;
            const cat = r.consumer_category || "Unknown";
            if (!catScores[cat]) catScores[cat] = [];
            catScores[cat].push(Number(r.avg_anomaly_score ?? 0));
            if (r.persistent_anomaly) persistentCount++;
          });

          const top_reason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";
          const riskiest_category = Object.entries(catScores).map(([k, v]) => ({ k, avg: v.reduce((s, x) => s + x, 0) / Math.max(1, v.length) })).sort((a, b) => b.avg - a.avg)[0]?.k || "N/A";
          const flagged = rows.filter((r: any) => r.anomaly_label === -1).length;
          const alert_rate = rows.length ? Math.round((flagged / rows.length) * 100) : 0;

          setInsights({ top_reason, riskiest_category, alert_rate, persistent_count: persistentCount, total: rows.length });
          generateQuickInsights(rows, mounted);
        } else {
          setInsights(null);
          setInsightsSummary(null);
        }
      } catch (err) {
        console.error("Failed to fetch customers", err);
        setCustomers([]);
        setFiltered([]);
        setInsights(null);
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [langState]);

  // generate quick insights (streaming)
  const generateQuickInsights = async (rows: any[], mountedFlag = true) => {
    if (!rows || rows.length === 0) return;
    setInsightsGenerating(true);
    setInsightsSummary(null);
    try {
      const prompt = [
        "You are an analytics copilot. Provide a concise, high-value summary of anomaly data.",
        `Language: ${i18n.language || langState}`,
        "Data (JSON array):",
        JSON.stringify(rows.slice(0, 50)),
      ].join("\n\n");

      const res = await fetch("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: prompt, lang: i18n.language || langState }) });
      if (!res.ok) { setInsightsSummary("⚠️ AI service unavailable. Try again later."); setInsightsGenerating(false); return; }

      let dataText = "";
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          dataText += chunk;
          if (!mountedFlag) break;
          setInsightsSummary(dataText);
        }
      } else {
        dataText = await res.text();
        setInsightsSummary(dataText);
      }
    } catch (err) {
      console.error("Insights error:", err);
      setInsightsSummary("⚠️ Something went wrong. Please retry.");
    } finally {
      setInsightsGenerating(false);
    }
  };

  // Spark bar mini
  const Spark = ({ value }: { value: number }) => {
    const v = Math.max(-1, Math.min(1, value));
    const bar = Math.abs(v) * 100;
    const color = v < -0.05 ? "#ef4444" : v > 0.05 ? "#34d399" : "#a855f7";
    return (
      <div className="w-28 h-2 bg-gray-100 rounded overflow-hidden">
        <div style={{ width: `${bar}%`, background: color, height: 8, borderRadius: 4 }} />
      </div>
    );
  };

  // filtering/sorting
 useEffect(() => {
  const s = search.trim().toLowerCase();
  let out = customers.slice();

  // Tabs logic
  if (tab === "alerts")
    out = out.filter(
      (c) => c.anomaly_label === -1 || c.persistent_anomaly === 1
    );
  if (tab === "stable")
    out = out.filter(
      (c) => c.anomaly_label === 1 && c.persistent_anomaly !== 1
    );

  // Category filter
  if (categoryFilter && categoryFilter !== "All") {
    out = out.filter(
      (c) => (c.consumer_category || "Unknown") === categoryFilter
    );
  }

  // Search
  if (s) {
    out = out.filter((c) =>
      c.customer_id.toLowerCase().includes(s)
    );
  }

  // Sorting
  if (sortKey) {
    out.sort((a: any, b: any) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }

  setFiltered(out);
  setPage(1);
}, [customers, tab, search, categoryFilter, sortKey, sortDir]);

 const categories = useMemo(() => {
  const setC = new Set<string>();
  customers.forEach((c) =>
    setC.add(c.consumer_category || "Unknown")
  );
  return ["All", ...Array.from(setC).sort()];
}, [customers]);

 const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
const pageItems = filtered.slice(
  (page - 1) * perPage,
  page * perPage
);
 const toggleSort = (key: keyof Customer) => {
  if (sortKey === key)
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  else {
    setSortKey(key);
    setSortDir("desc");
  }
};

  // Inline CSS for shimmer, pulses, hover glows (move to globals.css if you prefer)
const InlineStyles = (
  <style>{`
    @keyframes vivid-shimmer {
      0% { background-position: -250% 0; }
      100% { background-position: 250% 0; }
    }

    .hover-glow:hover {
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.2);
      transform: translateY(-3px);
      transition: all 0.25s ease;
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
      box-shadow:
        0 0 16px rgba(216, 180, 254, 0.25),
        0 0 32px rgba(168, 85, 247, 0.15),
        inset 0 0 8px rgba(255, 255, 255, 0.05);
    }

    .card-hover:hover {
      box-shadow: 0 12px 40px rgba(168,85,247,0.08);
      transform: translateY(-4px);
      transition: all 220ms ease;
    }

    .glow-tab:hover {
      box-shadow: 0 0 20px rgba(168,85,247,0.18);
      transform: translateY(-3px);
      transition: all 180ms ease;
    }

    .table-row-hover:hover {
      background: linear-gradient(90deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
      box-shadow: inset 0 0 0 1px rgba(168,85,247,0.02);
      transition: all 160ms ease;
    }

    /* --- Enhanced table visuals --- */
    .dashboard-table {
      border-collapse: separate;
      border-spacing: 0;
      border-radius: 12px;
      overflow: hidden;
    }

    .dashboard-table thead {
      background: linear-gradient(
        90deg,
        rgba(236, 72, 153, 0.06),
        rgba(168, 85, 247, 0.08)
      );
      color: rgba(88, 28, 135, 0.9);
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .dashboard-table th {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(168, 85, 247, 0.12);
      backdrop-filter: blur(4px);
    }

    .dashboard-table td {
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(168, 85, 247, 0.06);
    }

    .dashboard-table tr:last-child td {
      border-bottom: none;
    }

    .dashboard-table tbody tr:hover {
      background: linear-gradient(
        90deg,
        rgba(216, 180, 254, 0.08),
        rgba(236, 72, 153, 0.06)
      );
      box-shadow: inset 0 0 0 1px rgba(168, 85, 247, 0.08);
      transition: all 0.25s ease;
    }

    .regenerate-btn {
      display:inline-flex;
      align-items:center;
      justify-content:center;
      padding:8px;
      border-radius:999px;
      background:linear-gradient(90deg,#7c3aed,#ec4899);
      color:white;
      box-shadow: 0 6px 26px rgba(124,58,237,0.18);
      border:none;
      cursor:pointer;
    }

    .regenerate-btn:hover {
      transform: scale(1.06);
      box-shadow: 0 10px 40px rgba(124,58,237,0.28);
      transition: all 180ms ease;
    }

    :root {
      color-scheme: light dark;
    }

    /* 🌑 True rich dark gradient background */
    html.dark {
      background: #0e0a1f !important;
      color: #f4f0ff;
    }

    /* card and surface transparency */
    .dark .bg-white\\/60,
    .dark .bg-white\\/40,
    .dark .bg-white\\/30,
    .dark .bg-white\\/80 {
      background-color: #19142c !important;
      color: #f5f3ff !important;
    }

    .dark .dashboard-table {
      background-color: rgba(255, 255, 255, 0.05);
      border-radius: 12px;
    }

    .dark .dashboard-table th,
    .dark .dashboard-table td {
      border-color: rgba(255, 255, 255, 0.1);
    }

    .dark .bg-white\\/40 {
      background-color: rgba(30, 15, 50, 0.4) !important;
    }

    .dark .bg-white\\/30 {
      background-color: rgba(25, 10, 45, 0.35) !important;
    }

    .dark .bg-white\\/80 {
      background-color: rgba(45, 25, 70, 0.75) !important;
    }

    /* text and borders */
    .dark .text-gray-900,
    .dark .text-gray-800 {
      color: #f3f0ff !important;
    }

    .dark .text-gray-700,
    .dark .text-gray-600 {
      color: #e9e6f7 !important;
    }

    .dark .border-white\\/10,
    .dark .border-white\\/20 {
      border-color: rgba(255, 255, 255, 0.08) !important;
    }

    /* subtle card glow */
    .dark .card-hover:hover {
      box-shadow: 0 0 30px rgba(168, 85, 247, 0.15);
    }

    /* gradient-based hover shimmer for tabs */
    .dark .glow-tab:hover {
      box-shadow: 0 0 22px rgba(200, 120, 255, 0.25);
    }

    /* 🌈 Metric card glow */
    .metric-card {
      border: 1px solid rgba(168, 85, 247, 0.25);
      box-shadow:
        0 0 15px rgba(168, 85, 247, 0.15),
        inset 0 0 8px rgba(255, 255, 255, 0.05);
      transition: all 0.3s ease;
    }

    .card-hover {
      box-shadow: 0 0 30px rgba(168, 85, 247, 0.25);
      transform: translateY(0);
    }

    .metric-card:hover {
      box-shadow:
        0 0 25px rgba(168, 85, 247, 0.25),
        0 0 40px rgba(236, 72, 153, 0.15);
      transform: translateY(-3px);
    }

    /* 💫 Panels glow (Quick Insights & Top Flagged) */
    .panel-card {
      border: 1px solid rgba(168, 85, 247, 0.2);
      box-shadow:
        0 0 20px rgba(168, 85, 247, 0.12),
        inset 0 0 8px rgba(255, 255, 255, 0.03);
      transition: all 0.3s ease;
    }

    .panel-card:hover {
      box-shadow: 0 0 35px rgba(168, 85, 247, 0.25);
    }

    /* 🌑 Dark mode variations */
    .dark .metric-card {
      border: 1px solid rgba(200, 120, 255, 0.25);
      box-shadow: 0 0 25px rgba(168, 85, 247, 0.1);
      background-color: rgba(25, 15, 45, 0.65) !important;
    }

    .dark .metric-card:hover {
      box-shadow: 0 0 40px rgba(168, 85, 247, 0.25);
    }

    .dark .panel-card {
      border: 1px solid rgba(200, 120, 255, 0.2);
      background-color: rgba(20, 10, 40, 0.7) !important;
      box-shadow: 0 0 20px rgba(168, 85, 247, 0.1);
    }

    .dark .panel-card:hover {
      box-shadow: 0 0 35px rgba(168, 85, 247, 0.25);
    }

    /* 🌙 Dark mode readability improvements */
    .dark input,
    .dark select,
    .dark textarea {
      background-color: rgba(40, 25, 65, 0.8) !important;
      color: #f3e8ff !important;
      border: 1px solid rgba(200, 120, 255, 0.25) !important;
    }

    .dark input::placeholder,
    .dark select::placeholder,
    .dark textarea::placeholder {
      color: rgba(220, 180, 255, 0.6) !important;
    }

    /* 🌙 Fix filter buttons & dropdown contrast in dark mode */
    .dark .bg-gray-100,
    .dark .bg-white,
    .dark .bg-white\\/60 {
      background-color: rgba(35, 25, 60, 0.9) !important;
      color: #e5d5ff !important;
      border-color: rgba(200, 120, 255, 0.3) !important;
    }

    .dark button.text-gray-700,
    .dark select.text-gray-700,
    .dark input.text-gray-700 {
      color: #e5d5ff !important;
    }

    .dark .glow-tab:hover {
      color: #ffffff !important;
      background-color: rgba(150, 80, 220, 0.3) !important;
      box-shadow: 0 0 12px rgba(168, 85, 247, 0.25);
    }

    /* Dropdown caret visibility fix */
    .dark select {
      background-color: rgba(35, 25, 60, 0.9) !important;
      background-image: linear-gradient(45deg, transparent 50%, #c084fc 50%),
                        linear-gradient(135deg, #c084fc 50%, transparent 50%);
      background-position: calc(100% - 15px) calc(1em + 2px),
                           calc(100% - 10px) calc(1em + 2px);
      background-size: 5px 5px, 5px 5px;
      background-repeat: no-repeat;
    }

    /* 🌑 Dark mode fix for white table bg */
    .dark .dashboard-table {
      background-color: rgba(25, 15, 45, 0.8) !important;
      backdrop-filter: blur(8px);
    }

    .dark .dashboard-table thead {
      background: rgba(45, 25, 70, 0.7) !important;
    }

    .dark .dashboard-table tbody tr {
      background: rgba(25, 15, 45, 0.6);
    }

    .dark .dashboard-table tbody tr:nth-child(even) {
      background: rgba(25, 15, 45, 0.5);
    }

    .dark .dashboard-table tbody tr:hover {
      background: linear-gradient(
        90deg,
        rgba(150, 80, 220, 0.25),
        rgba(200, 120, 255, 0.2)
      ) !important;
    }
  `}</style>
);


  return (
    <div className="min-h-screen py-10 text-gray-900">
      {InlineStyles}

      {/* Top Cards */}
      <section className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {[
          { icon: <User size={20} />, color: "from-purple-500 to-fuchsia-500", label: t("metrics.total_customers") || "Total Customers", value: customers.length },
          { icon: <AlertTriangle size={20} />, color: "from-rose-600 to-rose-400", label: t("metrics.ai_alerts") || "AI Alerts", value: alerts },
          { icon: <Repeat size={20} />, color: "from-amber-600 to-amber-400", label: t("metrics.persistent_anomalies") || "Persistent Anomalies", value: customers.filter((c) => c.persistent_anomaly === 1).length },
          { icon: <Database size={20} />, color: "from-emerald-600 to-emerald-400", label: t("metrics.data_source") || "Data Source", value: t("local_neon") || "Local / Neon" },
        ].map((c, i) => (
          <div key={i} className="metric-card bg-white/60 backdrop-blur-xl rounded-xl p-4 flex items-center gap-3">
            <div className={`p-3 rounded-full text-white bg-gradient-to-br ${c.color}`}>{c.icon}</div>
            <div>
              <div className="text-xs opacity-70">{c.label}</div>
              <div className="text-2xl font-semibold">{c.value}</div>
            </div>
          </div>
        ))}
      </section>

      {/* Top flagged + insights */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">

        <div className="panel-card bg-white/60 backdrop-blur-xl rounded-xl p-4">
          <h3 className="font-semibold mb-3 text-purple-700">{t("top_flagged") || "Top flagged"}</h3>
          <div className="space-y-3">
            {customers.slice(0, 6).map((c) => (
              <div key={c.customer_id} className="flex items-center justify-between py-2 border-b border-white/10 last:border-b-0 table-row-hover">
                <div>
                  <div className="text-sm font-medium text-purple-600 hover:underline"><a href={`/customer/${c.customer_id}`}>{c.customer_id}</a></div>
                  <div className="text-xs opacity-70">{c.consumer_category} • {c.persistent_anomaly ? (t("repeated") || "Repeated") : (t("single_anomaly") || "One-off")}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Spark value={c.avg_anomaly_score} />
                  <div className={`text-sm font-medium ${c.anomaly_label === -1 ? "text-rose-400" : "text-emerald-400"}`}>
  {c.anomaly_label === -1
    ? (t("status.anomalous") || "Anomalous")
    : (t("status.normal") || "Normal")}
</div>

                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel-card bg-white/60 backdrop-blur-xl rounded-xl p-4">
  <div className="flex items-center justify-between mb-2">
    <h3 className="font-semibold text-purple-700">
      {t("quick_insights") || "Quick Insights"}
    </h3>
    <button
      className="regenerate-btn"
      onClick={() => generateQuickInsights(customers)}
      title={t("regenerate") || "Regenerate"}
    >
      <RotateCcw size={16} />
    </button>
  </div>

  <div
  className="mt-3 text-sm rounded-lg p-3 border border-white/10 bg-white/40 dark:bg-[#1b1630]/60 transition-all duration-500 ease-in-out"
  style={{ minHeight: "160px" }}
>

    {insightsGenerating ? (
      <div className="shimmer-rect p-3 text-white rounded-md">
        {t("generating_insights") || "Generating insights…"}
      </div>
    ) : insightsSummary ? (
      <ReactMarkdown rehypePlugins={[rehypeRaw]}>
        {insightsSummary}
      </ReactMarkdown>
    ) : (
      <div className="text-gray-500">
        {t("no_insights") || "No insights available"}
      </div>
    )}
  </div>
</div>

      </section>

      {/* Table */}
      <section className="bg-white/60 dark:bg-[#1b1630]/70 backdrop-blur-xl rounded p-4 shadow mt-6 border border-white/10">

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex gap-1 rounded overflow-hidden bg-gray-100">
            {(["all", "alerts", "stable"] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-sm ${tab === k ? "bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white" : "text-gray-700 hover:text-purple-600 glow-tab"}`}>
                {t(`filters.${k}`) || k.toUpperCase()}
              </button>
            ))}
          </div>

          <select
  value={categoryFilter}
  onChange={(e) => setCategoryFilter(e.target.value)}
  className="ml-3 border rounded px-3 py-2 text-sm bg-white text-gray-700"
>
  {categories.map((c) => (
    <option key={c} value={c}>
      {c}
    </option>
  ))}
</select>


          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search.placeholder") || "Search customers or score"} className="ml-auto px-3 py-2 rounded border bg-white text-sm text-gray-700" />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm dashboard-table rounded-lg overflow-hidden">

            <thead className="bg-white/75">
              <tr>
                <th className="p-3 text-left">{t("table.customer") || t("customer") || "Customer"}</th>
                <th className="p-3">{t("table.category") || t("category") || "Category"}</th>
                <th className="p-3">{t("table.score")}</th>
               
                <th className="p-3">{t("table.persistent")}</th>
                <th className="p-3">{t("table.status")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-4 text-center">Loading…</td></tr>
              ) : pageItems.length === 0 ? (
                <tr><td colSpan={6} className="p-4 text-center">{t("no_results") || "No results"}</td></tr>
              ) : (
                pageItems.map((c) => (
                  <tr key={c.customer_id} className="border-b border-white/10 table-row-hover">
  <td className="p-3 text-purple-600">
    <a href={`/customer/${c.customer_id}`}>{c.customer_id}</a>
  </td>
  <td className="p-3">{c.consumer_category || "—"}</td>
  <td className="p-3">{(c.avg_anomaly_score ?? 0).toFixed(4)}</td>
  <td className="p-3">
    {c.persistent_anomaly ? t("general.yes") : t("general.no")}
  </td>
  <td
    className={`p-3 ${
      c.anomaly_label === -1 ? "text-rose-400" : "text-emerald-400"
    }`}
  >
    {c.anomaly_label === -1
      ? t("status.anomalous") || "Anomalous"
      : t("status.normal") || "Normal"}
  </td>
</tr>

                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4">
  <div className="text-xs text-gray-700">
    {t("pagination.showing")}{" "}
    {Math.min(filtered.length, (page - 1) * perPage + 1)}–
    {Math.min(filtered.length, page * perPage)}{" "}
    {t("pagination.of")} {filtered.length}
  </div>
  <div className="flex items-center gap-2">
    <button
      onClick={() => setPage((p) => Math.max(1, p - 1))}
      className="px-3 py-1 rounded bg-white"
    >
      {t("pagination.prev")}
    </button>
    <div className="text-sm">{page}/{pageCount}</div>
    <button
      onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
      className="px-3 py-1 rounded bg-white"
    >
      {t("pagination.next")}
    </button>
  </div>
</div>

      </section>

      {/* Copilot */}
      <CopilotInner i18nLanguage={langState} />
    </div>
  );
}
