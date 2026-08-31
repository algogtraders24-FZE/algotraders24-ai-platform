"use client";
// components/quant-lite/CodeGenerationPanel.tsx
// Q1.4 Part 19/20 - "Generate Code" on a completed backtest result. Only
// offers the 3 languages that passed this program's own generator
// validation (Q1.4_EXISTING_CODEGEN_AUDIT.md / Q1.4_GOLDEN_STRATEGIES.md) -
// all 3 currently do, so all 3 are shown. Download is a client-side blob
// (no server-side file storage, no filesystem path ever crosses the
// network) - the filename is derived deterministically from the strategy
// name + language, sanitized independently of the generated CODE's own
// server-side sanitization (Q1.4_SECURITY_VALIDATION.md).
import { useState } from "react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { generateCode, QuantLiteApiError } from "@/services/quant-lite/QuantLiteBacktestService";
import { SUPPORTED_CODEGEN_LANGUAGES } from "@/types/quant-lite-codegen";
import type { TargetLanguage } from "@/types/quant-lite-codegen";
import type { StrategySpec } from "@/types/quant-lite";

const LANGUAGE_LABEL: Record<TargetLanguage, string> = { mql4: "MT4", mql5: "MT5", pine: "Pine Script" };
const LANGUAGE_EXT: Record<TargetLanguage, string> = { mql4: "mq4", mql5: "mq5", pine: "pine" };

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9-_ ]/g, "").trim().replace(/\s+/g, "-");
  return cleaned || "quant-lite-strategy";
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function CodeGenerationPanel({ strategy }: { strategy: StrategySpec }) {
  const [loading, setLoading] = useState<TargetLanguage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastGenerated, setLastGenerated] = useState<TargetLanguage | null>(null);

  async function handleGenerate(lang: TargetLanguage) {
    setLoading(lang);
    setError(null);
    try {
      const result = await generateCode(strategy, lang);
      const filename = `${sanitizeFilename(strategy.name || "quant-lite-strategy")}.${LANGUAGE_EXT[lang]}`;
      downloadText(filename, result.code);
      setLastGenerated(lang);
    } catch (e) {
      const message = e instanceof QuantLiteApiError ? e.message : "Could not generate code. Please try again.";
      setError(message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card>
      <h2 className="mb-2 text-sm font-semibold text-text">Generate Code</h2>
      <p className="mb-3 text-xs text-text-3">
        Generated code follows the Quant Lite strategy specification and declared execution assumptions. Validate and test it
        on your platform before live use.
      </p>
      <div className="flex flex-wrap gap-2">
        {SUPPORTED_CODEGEN_LANGUAGES.map((lang) => (
          <Button key={lang} variant="secondary" size="sm" onClick={() => handleGenerate(lang)} disabled={loading !== null}>
            {loading === lang ? "Generating..." : `Generate ${LANGUAGE_LABEL[lang]}`}
          </Button>
        ))}
      </div>
      {lastGenerated && !error && <p className="mt-2 text-xs text-text-3">{LANGUAGE_LABEL[lastGenerated]} file downloaded.</p>}
      {error && <p className="mt-2 rounded-control border border-danger/30 bg-danger/10 p-2 text-xs text-danger">{error}</p>}
    </Card>
  );
}
