// services/evidence-sources/collect-context.ts
// Runs the production extra evidence sources (economic calendar, macro drivers, SMC
// structure) for one symbol and returns whatever they produced. Used by surfaces that
// show context next to their own analysis (Trading Copilot). Every source runs in
// parallel under a timeout; a source that is unconfigured, fails or times out simply
// contributes nothing - absence is never padded or estimated.

import type { EvidenceItem, EvidenceType } from "@/types/evidence";
import type { EvidenceExtraSource } from "@/types/evidence-fusion";

export const CONTEXT_SOURCE_TIMEOUT_MS = 4000;

const TYPE_LABEL: Partial<Record<EvidenceType, string>> = {
  macro: "Economic calendar",
  "cross-asset": "Macro drivers",
  technical: "Market structure",
  news: "News",
};

export function contextLabel(type: EvidenceType): string {
  return TYPE_LABEL[type] ?? "Context";
}

export async function collectContextEvidence(
  sources: EvidenceExtraSource[],
  symbol: string,
  timeoutMs: number = CONTEXT_SOURCE_TIMEOUT_MS,
): Promise<EvidenceItem[]> {
  const settled = await Promise.all(
    sources
      .filter((s) => s.isConfigured())
      .map(async (s) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            s.collect({ symbol }),
            new Promise<EvidenceItem[]>((_, reject) => {
              timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
            }),
          ]);
        } catch {
          return [] as EvidenceItem[];
        } finally {
          if (timer) clearTimeout(timer);
        }
      }),
  );
  return settled.flat();
}
