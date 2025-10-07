import { NextResponse } from "next/server";
import textToSpeech from "@google-cloud/text-to-speech";

export const runtime = "nodejs"; // ✅ ensure Node environment for GCP SDK

const client = new textToSpeech.TextToSpeechClient();

export async function POST(req: Request) {
  try {
    const { text, lang = "en" } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid text input" },
        { status: 400 }
      );
    }

    // 🧠 Smart, fault-tolerant language normalization
    const normalizedLang =
      lang.includes("hi") ? "hi-IN" :
      lang.includes("mr") ? "mr-IN" :
      lang.includes("en") ? "en-IN" :
      "en-IN";

    // 🎙️ Valid, working Google Cloud voice map
    const voiceOptions: Record<string, any> = {
      "en-IN": { name: "en-IN-Wavenet-D", languageCode: "en-IN" }, // ✅ Works
      "hi-IN": { name: "hi-IN-Neural2-C", languageCode: "hi-IN" },
      "mr-IN": { name: "mr-IN-Wavenet-B", languageCode: "mr-IN" },
    };

    let voice = voiceOptions[normalizedLang];

    // 🚑 Fallback if chosen voice doesn’t exist
    if (!voice) {
      console.warn(`⚠️ Unknown voice for ${normalizedLang}, falling back to en-IN`);
      voice = voiceOptions["en-IN"];
    }

    // ⚡ Natural, expressive “Gemini-style” tuning
    const [response] = await client.synthesizeSpeech({
      input: { text },
      voice: {
        ...voice,
        ssmlGender: "MALE",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.22, // 💨 slightly faster but natural
        pitch: 1.8,         // 🎵 clear and warm tone
        effectsProfileId: ["telephony-class-application"],
      },
    });

    const audioContent = response.audioContent as string | undefined;
    if (!audioContent) {
      return NextResponse.json(
        { error: "No audio content returned from Google TTS" },
        { status: 500 }
      );
    }

    // ✅ Binary MP3 response
    const buffer = Uint8Array.from(Buffer.from(audioContent, "base64"));
    return new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    console.error("❌ Google TTS error:", error);
    return NextResponse.json(
      { error: "TTS generation failed", details: String(error) },
      { status: 500 }
    );
  }
}
