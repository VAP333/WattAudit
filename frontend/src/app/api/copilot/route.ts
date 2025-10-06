import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { query, audioEnabled = false } = await req.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Missing Gemini API key" },
        { status: 500 }
      );
    }

    // 1️⃣ Detect if user asked about a specific customer (e.g., "CUST1021")
    const customerIdMatch = query.match(/CUST\d+/i);
    let backendData: any = null;
    let contextType = "global";

    if (customerIdMatch) {
      const customerId = customerIdMatch[0].toUpperCase();
      const customerResp = await fetch(`http://localhost:8000/customer/${customerId}`);
      backendData = await customerResp.json();
      contextType = "customer";
    } else {
      const backendResp = await fetch("http://localhost:8000/customers");
      backendData = await backendResp.json();
    }

    // 2️⃣ Enrich prompt with backend data
    const enrichedPrompt = `
You are WattAudit++ Copilot — an explainable AI assistant.

User's question:
"${query}"

Relevant ${contextType === "customer" ? `customer (${backendData.customer_id})` : "global"} anomaly data:
${JSON.stringify(backendData)}

Answer the question based ONLY on this data.
- If it's a customer query, give detailed anomaly explanation, reasoning, and patterns.
- If it's a global query, summarize trends, top anomalies, categories, etc.
- Be clear, concise, and insightful. Use bullet points or clean paragraphs.
- DO NOT use asterisks (*) for formatting. Use plain text or clean bullet points like:
  - Example point 1
  - Example point 2
`;

    // 3️⃣ Initialize Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // 4️⃣ Toggle audio vs text mode based on `audioEnabled`
    const generationConfig = audioEnabled
      ? { responseMimeType: "audio/ogg; codecs=opus" }
      : { responseMimeType: "text/plain" };

    const streamingResp = await model.generateContentStream({
      contents: [{ role: "user", parts: [{ text: enrichedPrompt }] }],
      generationConfig,
    });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamingResp.stream) {
            const text = chunk?.text();
            if (text) controller.enqueue(encoder.encode(text));
          }
        } catch (err) {
          console.error("Streaming error:", err);
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
