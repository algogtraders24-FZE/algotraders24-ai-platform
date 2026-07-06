// app/api/ai/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { AI_CONFIG } from "@/config/ai.config";
import { classifyError } from "@/services/ai/providers/provider-errors";

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json({ ok: false, kind: "invalid-key", content: "API key not configured." }, { status: 200 });
  }

  try {
    const { prompt } = (await req.json()) as { prompt: string };
    const ai = new GoogleGenAI({ apiKey: key });
    const res = await ai.models.generateContent({
      model: AI_CONFIG.defaultModel,
      contents: prompt,
    });
    return NextResponse.json({ ok: true, content: res.text ?? "" }, { status: 200 });
  } catch (err) {
    const { kind, message } = classifyError(err);
    return NextResponse.json({ ok: false, kind, content: message }, { status: 200 });
  }
}