// services/knowledge/TextChunker.ts
// Sprint 15B.7 - Deterministic, dependency-free text chunking.
// Char-based sliding window with overlap. Pure function: same input -> same
// output, no I/O, no randomness. Consumed by IngestionService.

export interface TextChunk {
  content: string;
  chunkIndex: number;
  charCount: number;
  tokenCount: number; // rough estimate (~chars/4); real tokenization deferred
}

export interface ChunkOptions {
  chunkSize?: number;
  overlap?: number;
}

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_OVERLAP = 150;

export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  if (typeof text !== "string") {
    throw new Error("[chunker] text must be a string");
  }
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? DEFAULT_OVERLAP;

  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("[chunker] chunkSize must be a positive integer");
  }
  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new Error("[chunker] overlap must be a non-negative integer");
  }
  if (overlap >= chunkSize) {
    // Guard against a non-advancing / infinite loop.
    throw new Error("[chunker] overlap must be smaller than chunkSize");
  }

  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // Short document: a single chunk.
  if (trimmed.length <= chunkSize) {
    return [
      {
        content: trimmed,
        chunkIndex: 0,
        charCount: trimmed.length,
        tokenCount: Math.ceil(trimmed.length / 4),
      },
    ];
  }

  const step = chunkSize - overlap; // guaranteed >= 1
  const chunks: TextChunk[] = [];
  let index = 0;

  for (let start = 0; start < trimmed.length; start += step) {
    const slice = trimmed.slice(start, start + chunkSize).trim();
    if (slice.length === 0) continue;
    chunks.push({
      content: slice,
      chunkIndex: index,
      charCount: slice.length,
      tokenCount: Math.ceil(slice.length / 4),
    });
    index += 1;
    if (start + chunkSize >= trimmed.length) break;
  }

  return chunks;
}
