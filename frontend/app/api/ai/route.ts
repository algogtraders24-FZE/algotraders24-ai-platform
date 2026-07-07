// app/api/ai/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { AI_CONFIG } from "@/config/ai.config";
import { classifyError } from "@/services/ai/providers/provider-errors";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, kind: "invalid-key", content: "API key not configured." }, { status: 200 });
  }

  const { prompt, useSearch } = (await req.json()) as { prompt: string; useSearch?: boolean };
  const ai = new GoogleGenAI({ apiKey: key });

  let lastMessage = "Request failed.";
  let lastKind = "unknown";

  for (let attempt = 0; attempt <= AI_CONFIG.retryCount; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: AI_CONFIG.defaultModel,
        contents: prompt,
        config: useSearch ? { tools: [{ googleSearch: {} }] } : {},
      });
      return NextResponse.json({ ok: true, content: res.text ?? "" }, { status: 200 });
    } catch (err) {
      const { kind, message } = classifyError(err);
      lastMessage = message;
      lastKind = kind;
      const overloaded = message.toLowerCase().includes("503") || message.toLowerCase().includes("unavailable") || message.toLowerCase().includes("overload");
      if (overloaded && attempt < AI_CONFIG.retryCount) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  return NextResponse.json({ ok: false, kind: lastKind, content: lastMessage }, { status: 200 });
}
