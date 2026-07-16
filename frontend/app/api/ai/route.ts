// app/api/ai/route.ts
// RECONCILE (15A.3): non-search path delegates to unified AIService
// (removes duplicated GoogleGenAI construction). useSearch path stays on
// direct SDK because GeminiProvider defers tool-calling (15A.2).
// Response shape { ok, content, kind } preserved byte-for-byte.
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { AI_CONFIG } from "@/config/ai.config";
import { createAIService } from "@/lib/ai";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Self-contained error classifier (no external dependency).
function classify(err: unknown): { kind: string; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  let kind = "unknown";
  if (lower.includes("api key") || lower.includes("unauth") || lower.includes("401") || lower.includes("403")) {
    kind = "invalid-key";
  } else if (lower.includes("rate") || lower.includes("quota") || lower.includes("429")) {
    kind = "rate-limit";
  } else if (lower.includes("network") || lower.includes("fetch failed")) {
    kind = "network";
  }
  return { kind, message };
}

export async function POST(req: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, kind: "invalid-key", content: "API key not configured." },
      { status: 200 },
    );
  }

  const { prompt, useSearch } = (await req.json()) as {
    prompt: string;
    useSearch?: boolean;
  };

  // Non-search path: delegate to unified AIService (single execution path).
  if (!useSearch) {
    try {
      const res = await createAIService().complete(prompt);
      return NextResponse.json({ ok: true, content: res.content }, { status: 200 });
    } catch (err) {
      const { kind, message } = classify(err);
      return NextResponse.json({ ok: false, kind, content: message }, { status: 200 });
    }
  }

  // RECONCILE: search path stays on direct SDK until tool-calling lands in
  // GeminiProvider. Behavior identical to legacy implementation.
  const ai = new GoogleGenAI({ apiKey: key });
  let lastMessage = "Request failed.";
  let lastKind = "unknown";

  for (let attempt = 0; attempt <= AI_CONFIG.retryCount; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: AI_CONFIG.defaultModel,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] },
      });
      return NextResponse.json({ ok: true, content: res.text ?? "" }, { status: 200 });
    } catch (err) {
      const c = classify(err);
      lastMessage = c.message;
      lastKind = c.kind;
      const lower = c.message.toLowerCase();
      const overloaded =
        lower.includes("503") ||
        lower.includes("unavailable") ||
        lower.includes("overload");
      if (overloaded && attempt < AI_CONFIG.retryCount) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      break;
    }
  }

  return NextResponse.json(
    { ok: false, kind: lastKind, content: lastMessage },
    { status: 200 },
  );
}
