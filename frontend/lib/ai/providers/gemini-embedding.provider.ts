// lib/ai/providers/gemini-embedding.provider.ts
// Sprint 15B.6 - First real EmbeddingProvider. Mirrors gemini.provider.ts
// (timeout + error normalization) and implements the 15B.5 contract.
// SERVER-ONLY: reads GEMINI_API_KEY via loadGeminiEmbeddingEnv(); the key is
// never logged, never returned, and never crosses a client boundary.
import { GoogleGenAI } from "@google/genai";
import type { EmbeddingProvider } from "../embedding.interface";
import {
  assertValidEmbeddingInput,
  assertValidEmbeddingOutput,
} from "../embedding.interface";
import type { EmbeddingRequest, EmbeddingResult } from "../embedding.types";
import { EMBEDDING_DIMENSIONS } from "../embedding.types";
import { AIProviderError, type AIErrorKind } from "../errors";
import { loadGeminiEmbeddingEnv } from "../env";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "gemini" as const;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor() {
    const env = loadGeminiEmbeddingEnv();
    this.client = new GoogleGenAI({ apiKey: env.apiKey });
    this.model = env.model;
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const text = assertValidEmbeddingInput(req.text, this.name);
    const model = req.model ?? this.model;
    const started = Date.now();

    try {
      const result = await this.withTimeout(
        this.client.models.embedContent({
          model,
          contents: text,
          config: { outputDimensionality: EMBEDDING_DIMENSIONS },
        }),
        DEFAULT_TIMEOUT_MS,
      );

      const values = result.embeddings?.[0]?.values;
      if (!values) {
        throw new AIProviderError(
          "invalid_output",
          "Provider returned no embedding values",
          this.name,
        );
      }

      const vector = assertValidEmbeddingOutput(values, this.name);

      return {
        embedding: this.normalize(vector),
        dimensions: vector.length,
        model,
        provider: this.name,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private normalize(vector: number[]): number[] {
    let sumSquares = 0;
    for (const v of vector) sumSquares += v * v;
    const magnitude = Math.sqrt(sumSquares);
    if (magnitude === 0) return vector;
    return vector.map((v) => v / magnitude);
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AIProviderError("timeout", `Request exceeded ${ms}ms`, this.name),
          ),
        ms,
      );
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  private normalizeError(err: unknown): AIProviderError {
    if (err instanceof AIProviderError) return err;

    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number })?.status;
    let kind: AIErrorKind = "unknown";
    if (status === 401 || status === 403 || /api key|unauth/i.test(msg)) {
      kind = "auth";
    } else if (status === 429 || /rate.?limit|quota/i.test(msg)) {
      kind = "rate_limit";
    } else if (/network|fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
      kind = "network";
    }
    return new AIProviderError(kind, msg, this.name, err);
  }
}
