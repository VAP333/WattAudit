"use client";
import React, { useEffect, useRef, useState } from "react";
import { Bot, RotateCcw, Send, Volume2, VolumeX, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import { useTranslation } from "react-i18next";

type Message = { role: "user" | "assistant"; content: string };

export default function Copilot({ i18nLanguage }: { i18nLanguage: string }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [soundOn, setSoundOn] = useState(true);

  const chatRef = useRef<HTMLDivElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const speakingRef = useRef(false);
  const stopFlag = useRef(false);

  // Scroll chat
  useEffect(() => {
    if (open && chatRef.current)
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, open]);

  // --- 🧠 Realtime TTS Queue ---
  const enqueueTTS = async (text: string) => {
    if (!soundOn || !text.trim()) return;
    audioQueueRef.current.push(text.trim());
    playNextTTS();
  };

  const playNextTTS = async () => {
    if (speakingRef.current || audioQueueRef.current.length === 0) return;
    speakingRef.current = true;
    const text = audioQueueRef.current.shift();
    if (!text) {
      speakingRef.current = false;
      return;
    }

    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang: i18n.language || i18nLanguage }),
      });
      if (!res.ok) throw new Error("TTS failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        speakingRef.current = false;
        if (!stopFlag.current) playNextTTS();
      };
      await audio.play();
    } catch (err) {
      console.error("TTS error", err);
      speakingRef.current = false;
      if (!stopFlag.current) playNextTTS();
    }
  };

  const stopAllAudio = () => {
    stopFlag.current = true;
    audioQueueRef.current = [];
    speakingRef.current = false;
    setTimeout(() => (stopFlag.current = false), 500);
  };

  // --- 🧠 Send Chat Message ---
  const sendMessage = async () => {
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setIsSending(true);
    stopAllAudio();

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: text,
          lang: i18n.language || i18nLanguage || "en",
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        setMessages((m) => [
          ...m,
          { role: "assistant", content: `⚠️ ${msg}` },
        ]);
        return;
      }

      // Stream the response
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          assistantText += chunk;

          // Update message live
          setMessages((m) => {
            const copy = [...m];
            copy[copy.length - 1] = {
              role: "assistant",
              content: assistantText,
            };
            return copy;
          });

          // 🔊 Speak the new fragment in real time
          if (soundOn && chunk.trim()) enqueueTTS(chunk);
        }
      } else {
        const text = await res.text();
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: text };
          return copy;
        });
        if (soundOn) enqueueTTS(text);
      }
    } catch (err) {
      console.error("Copilot send error:", err);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ Error: Check backend" },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      {/* Floating Copilot button */}
      <button
        onClick={() => setOpen((s) => !s)}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center text-white shadow-2xl bg-gradient-to-r from-purple-600 to-fuchsia-600"
      >
        <Bot size={22} />
      </button>

      {open && (
        <div
          ref={chatRef}
          className="fixed bottom-24 right-6 z-[9999] bg-gradient-to-br from-purple-600/10 via-fuchsia-500/10 to-white/20 dark:from-purple-900/40 dark:via-fuchsia-800/30 dark:to-transparent border border-purple-400/30 backdrop-blur-2xl rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.25)] w-[600px] max-h-[500px] flex flex-col justify-between"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white rounded-t-2xl">
            <div className="flex items-center gap-2 font-semibold">
              <Bot size={16} /> WattAudit Copilot
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMessages([])}
                className="p-1 rounded-full hover:bg-white/20"
              >
                <RotateCcw size={16} />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-full hover:bg-white/20"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Chat */}
          <div className="p-4 overflow-y-auto space-y-3 text-sm flex-1">
            {messages.length === 0 ? (
              <div className="text-center text-gray-500 italic">
                🤖 {t("start_chat") || "Start chatting with your AI Copilot..."}
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-md ${
                    m.role === "user"
                      ? "ml-auto bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white"
                      : "mr-auto bg-white/90 text-gray-900 dark:bg-[#1b1630] dark:text-gray-100 border border-white/10"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <ReactMarkdown rehypePlugins={[rehypeRaw]}>
                      {m.content}
                    </ReactMarkdown>
                  ) : (
                    <>{m.content}</>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!isSending) sendMessage();
            }}
            className="p-3 border-t border-white/10 bg-white/5 flex items-center gap-2 rounded-b-2xl"
          >
            <button
              type="button"
              onClick={() => setSoundOn((s) => !s)}
              className="p-2 rounded-full bg-white/10"
              title={soundOn ? "Mute" : "Unmute"}
            >
              {soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("copilot.placeholder") || "Ask me anything..."}
              className="flex-1 rounded-full px-4 py-2 text-sm bg-white/80 dark:bg-[#1b1630] border border-white/10 focus:outline-none focus:ring-2 focus:ring-purple-300 text-gray-900"
            />
            <button
              disabled={isSending}
              type="submit"
              className="p-2 rounded-full bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white shadow-md"
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
