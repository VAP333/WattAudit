// components/CopilotInner.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { Bot, Send, X, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CopilotInnerProps {
  i18nLanguage: string;
  context?: {
    customer_id?: string;
    profile?: Record<string, any>;
    records?: any[];
    ai_summary?: string;
  };
}

export default function CopilotInner({ i18nLanguage, context }: CopilotInnerProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false); // minimized default
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamingAbortRef = useRef<() => void>(() => {});
  const initialGeneratedRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // 🌐 Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  // 🎙 Setup SpeechRecognition
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const recog = new SR();
    const lang = i18nLanguage || i18n.language || "en";
    recog.lang = lang.startsWith("hi")
      ? "hi-IN"
      : lang.startsWith("mr")
      ? "mr-IN"
      : "en-IN";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onstart = () => {
      stopAudio(); // stop TTS if playing
      setIsListening(true);
    };
    recog.onend = () => setIsListening(false);
    recog.onerror = () => setIsListening(false);
    recog.onresult = (ev: any) => {
      try {
        const transcript = ev.results[0][0].transcript;
        setInput((s) => (s ? s + " " + transcript : transcript));
      } catch (e) {
        console.warn("Speech result error", e);
      }
    };
    recognitionRef.current = recog;
    return () => {
      try {
        recog.abort();
      } catch {}
      recognitionRef.current = null;
    };
  }, [i18nLanguage, i18n.language]);

  const startListening = useCallback(() => {
    const r = recognitionRef.current;
    if (!r) {
      alert(t("voice.unsupported") || "Voice not supported in this browser");
      return;
    }
    try {
      r.start();
    } catch {
      try {
        r.abort();
        r.start();
      } catch {}
    }
  }, [t]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {}
    setIsListening(false);
  }, []);

  // 🔈 Stop any active audio playback
  const stopAudio = useCallback(() => {
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      audioRef.current = null;
    } catch {}
  }, []);

  // 🔉 Play TTS safely
  const playAudioBlob = useCallback(
    async (blob: Blob | null) => {
      if (!blob || !soundOn) return;
      try {
        stopAudio();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          try {
            URL.revokeObjectURL(url);
          } catch {}
          audioRef.current = null;
        };
        await audio.play();
      } catch (err) {
        console.warn("TTS play failed", err);
      }
    },
    [soundOn, stopAudio]
  );

  // 🔁 Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudio();
      streamingAbortRef.current();
    };
  }, [stopAudio]);

  // 💬 Send message to Copilot API
  const sendQuery = useCallback(
    async (queryText: string, opts?: { audio?: boolean; userRole?: boolean }) => {
      if (!queryText || isSending) return;
      stopAudio(); // stop ongoing audio before new send
      setIsSending(true);
      if (opts?.userRole !== false)
        setMessages((m) => [...m, { role: "user", text: queryText }]);

      try {
        const payload: any = {
          query: queryText,
          lang: i18nLanguage || i18n.language || "en",
          audioEnabled: false,
          context,
        };

        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const txt = await res.text();
          setMessages((m) => [
            ...m,
            { role: "assistant", text: `⚠️ Copilot error: ${txt}` },
          ]);
          setIsSending(false);
          return;
        }

        const reader = res.body?.getReader();
        const dec = new TextDecoder();
        let assistantText = "";
        setMessages((m) => [...m, { role: "assistant", text: "" }]);

        if (reader) {
          const controllerAbort = { aborted: false };
          streamingAbortRef.current = () => {
            controllerAbort.aborted = true;
            reader.cancel().catch(() => {});
          };
          while (true) {
            if (controllerAbort.aborted) break;
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = dec.decode(value, { stream: true });
            assistantText += chunk;
            setMessages((m) => {
              const cp = [...m];
              let idx = cp.map((x) => x.role).lastIndexOf("assistant");
              if (idx < 0) idx = cp.length - 1;
              cp[idx] = { role: "assistant", text: assistantText };
              return cp;
            });
          }
        }

        // 🎧 Audio after completion
        if (soundOn && assistantText) {
          try {
            const ttsResp = await fetch("/api/tts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: assistantText,
                lang: i18nLanguage || i18n.language || "en",
              }),
            });
            if (ttsResp.ok) {
              const blob = await ttsResp.blob();
              await playAudioBlob(blob);
            }
          } catch (err) {
            console.warn("TTS failed", err);
          }
        }
      } catch (err) {
        console.error("Copilot query failed", err);
        setMessages((m) => [
          ...m,
          { role: "assistant", text: "⚠️ Copilot failed to generate a reply." },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [context, i18n.language, i18nLanguage, isSending, playAudioBlob, soundOn, stopAudio]
  );

  // 🪄 Auto initial summary once per customer/lang
  useEffect(() => {
    if (!open || !context?.customer_id) return;
    const key = `${context.customer_id}_${i18nLanguage || i18n.language}`;
    if (initialGeneratedRef.current === key) return;
    initialGeneratedRef.current = key;

    const langLabel = (i18nLanguage || i18n.language || "en").startsWith("hi")
      ? "Hindi"
      : (i18nLanguage || i18n.language || "en").startsWith("mr")
      ? "Marathi"
      : "English";

    const prompt = `
You are WattAudit Copilot. Provide a detailed, storytelling analysis for customer ${context.customer_id} in ${langLabel}.
Use recent records, anomaly data, and AI summary if available.
Highlight trends, irregularities, and suggestions for optimization.
Keep the tone analytical yet clear.
    `;
    void sendQuery(prompt, { audio: true, userRole: false });
  }, [open, context?.customer_id, i18nLanguage, i18n.language, sendQuery]);

  // 🧱 UI
  return (
    <>
      {/* Floating Copilot Button */}
      <button
        onClick={() => {
          stopAudio();
          setOpen((s) => !s);
        }}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center text-white shadow-2xl bg-gradient-to-r from-purple-600 to-fuchsia-600"
        aria-label={t("copilot.open_copilot") || "Open Copilot"}
      >
        <Bot size={22} />
      </button>

      {open && (
        <div className="fixed bottom-24 right-6 z-[9999] w-[min(560px,90vw)] max-h-[78vh] bg-white/90 dark:bg-[#14101f]/90 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white">
            <div className="flex items-center gap-2 font-semibold">
              <Bot size={16} /> WattAudit Copilot
            </div>
            <button
              title={t("copilot.close") || "Close"}
              onClick={() => {
                stopAudio();
                setOpen(false);
              }}
              className="p-1 rounded hover:bg-white/10"
            >
              <X size={16} />
            </button>
          </div>

          {/* Chat Area */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 text-sm">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 italic">
                🤖 {t("start_chat") || "Start chatting with your AI Copilot..."}
              </div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`max-w-[86%] px-4 py-3 rounded-2xl ${
                    m.role === "user"
                      ? "ml-auto bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white"
                      : "mr-auto bg-white/95 dark:bg-[#17121f] text-gray-900 dark:text-gray-100 border border-white/5"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <ReactMarkdown rehypePlugins={[rehypeRaw]}>{m.text}</ReactMarkdown>
                  ) : (
                    <div>{m.text}</div>
                  )}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t border-white/10 p-3 bg-white/5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim()) void sendQuery(input.trim());
                setInput("");
              }}
              className="flex items-center gap-2"
            >
              <button
                type="button"
                onClick={() => (isListening ? stopListening() : startListening())}
                className={`p-2 rounded-full ${
                  isListening ? "bg-purple-600 text-white" : "bg-white/10"
                }`}
                title={t("voice.start") || "Voice"}
              >
                🎤
              </button>

              <button
                type="button"
                onClick={() => {
                  setSoundOn((s) => !s);
                  stopAudio();
                }}
                className="p-2 rounded-full bg-white/10"
                title={soundOn ? t("audio.off") || "Mute" : t("audio.on") || "Unmute"}
              >
                {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>

              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  t("copilot.placeholder") ||
                  "Ask WattAudit Copilot... (English / Hindi / Marathi)"
                }
                className="flex-1 rounded-full px-4 py-2 text-sm bg-white/80 dark:bg-[#17121f] border border-white/5 focus:outline-none"
              />

              <button
                type="submit"
                disabled={isSending}
                className="p-2 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white"
                title={t("send") || "Send"}
              >
                <Send size={14} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
