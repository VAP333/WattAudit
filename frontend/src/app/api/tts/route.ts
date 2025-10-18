import { NextResponse } from "next/server";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";

export const runtime = "nodejs";

// ✅ Initialize Google Cloud TTS client
let client: TextToSpeechClient;
try {
  const credsJSON = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  client = credsJSON
    ? new TextToSpeechClient({ credentials: JSON.parse(credsJSON) })
    : new TextToSpeechClient();
} catch (err) {
  console.error("❌ Failed to initialize Google TTS client:", err);
  client = new TextToSpeechClient(); // fallback
}

export async function POST(req: Request) {
  try {
    const { text, lang = "en" } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'text' input." },
        { status: 400 }
      );
    }

    // ✅ Normalize and select correct voice
    const normalizedLang =
      lang.startsWith("hi") ? "hi-IN" :
      lang.startsWith("mr") ? "mr-IN" :
      "en-IN";

    const voiceOptions = {
      "en-IN": { name: "en-IN-Wavenet-D", languageCode: "en-IN" },
      "hi-IN": { name: "hi-IN-Neural2-C", languageCode: "hi-IN" },
      "mr-IN": { name: "mr-IN-Wavenet-B", languageCode: "mr-IN" },
    } as const;

    const voice = voiceOptions[normalizedLang] || voiceOptions["en-IN"];

    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice: { ...voice, ssmlGender: "MALE" },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.12,
        pitch: 1.6,
        effectsProfileId: ["headphone-class-device"],
      },
    });

    const audioContent = response.audioContent;
    if (!audioContent) {
      return NextResponse.json(
        { error: "No audio content returned from Google TTS." },
        { status: 500 }
      );
    }

    // ✅ Safe Buffer conversion for both string and Uint8Array
    const buffer =
      typeof audioContent === "string"
        ? Buffer.from(audioContent, "base64")
        : Buffer.from(audioContent);

    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    console.error("❌ Google TTS error:", error);
    return NextResponse.json(
      { error: "TTS generation failed", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
