import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      query,
      lang = "en",
      audioEnabled = false,
      customer_id,
      ai_summary,
      records,
    } = body;

    // 🧱 Validation
    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'query' or 'prompt' field." },
        { status: 400 }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Missing Gemini API key" },
        { status: 500 }
      );
    }

    // 1️⃣ Fetch backend context
    let backendData: any = null;
    let contextType = "global";

    try {
      if (customer_id) {
        const resp = await fetch(`http://localhost:8000/customer/${customer_id}`);
        backendData = await resp.json();
        contextType = "customer";
      } else {
        const resp = await fetch("http://localhost:8000/customers");
        backendData = await resp.json();
      }
    } catch (err) {
      console.warn("⚠️ Backend data fetch failed:", err);
      backendData = { note: "Backend data unavailable. Using frontend context." };
    }

    // 2️⃣ Determine language label
    const langLabel =
      lang.startsWith("hi") ? "Hindi" :
      lang.startsWith("mr") ? "Marathi" :
      "English";

    // 3️⃣ Sanitize records (Gemini-safe)
    const safeRecords = Array.isArray(records)
      ? records.slice(-6).map((r) => ({
          month: r.month,
          consumption_kwh: Number(r.consumption_kwh ?? 0),
          billed_kwh: Number(r.billed_kwh ?? 0),
          anomaly_score: Number(r.anomaly_score ?? 0),
          anomaly_label: r.anomaly_label ?? 0,
        }))
      : [];

    // 4️⃣ Construct a clean, compact prompt
    const enrichedPrompt = `
You are WattAudit Copilot — a multilingual AI energy auditor.
Your job is to analyze customer-level or system-level energy data and produce human-friendly insights.

Language: ${langLabel}
Context type: ${contextType}

User’s question:
"${query}"

${
  ai_summary
    ? `Existing AI Summary:\n${ai_summary}\n`
    : ""
}

Recent consumption records (if available):
${JSON.stringify(safeRecords, null, 2)}

Backend data (truncated sample):
${JSON.stringify(backendData, null, 2).slice(0, 2000)}  // Keep short to prevent model overload

Instructions:
- Write your entire response in ${langLabel}.
- Use clear and professional tone.
- Avoid markdown, emojis, or special characters.
- Focus on anomalies, trends, and actionable insights.
- Be concise but narrative (4–8 sentences max).
    `;

    // 5️⃣ Clean up extra spaces & line breaks
    const cleanPrompt = enrichedPrompt.replace(/\s+/g, " ").trim();

    // 6️⃣ Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 7️⃣ Response type
   // Gemini 2.5 currently does NOT allow audio MIME responses.
// We always request text, and handle voice playback separately via /api/tts.
const generationConfig = { responseMimeType: "text/plain" };


    // 8️⃣ Stream response
    const streamingResp = await model.generateContentStream({
      contents: [{ role: "user", parts: [{ text: cleanPrompt }] }],
      generationConfig,
    });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamingResp.stream) {
            const text = chunk?.text?.();
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch (err) {
          console.error("⚠️ Streaming error:", err);
          controller.enqueue(encoder.encode("Error: Streaming interrupted."));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("❌ Copilot route error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: String(error) },
      { status: 500 }
    );
  }
}
