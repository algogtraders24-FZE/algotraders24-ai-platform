// lib/knowledge/extractText.ts
// Sprint L2.2 - The one missing prerequisite the real ingestion pipeline
// (services/knowledge/IngestionService.ts) always needed but never had a
// source for: turning an uploaded file into plain text. Nothing here
// touches chunking, embedding, or storage - IngestionService, TextChunker,
// and GeminiEmbeddingProvider are reused completely unmodified downstream
// of this.
// pdf-parse (pdfjs) is imported LAZILY, only when a PDF is actually read. A top-level import evaluates pdfjs when the
// route module loads, and on Vercel that threw "ReferenceError: DOMMatrix is not defined" (no @napi-rs/canvas in the
// serverless bundle) - which crashed EVERY upload, TXT/MD/DOCX included, with an empty 500. Now only PDFs are affected,
// and they fail with a readable message instead of a crash. mammoth is lazy for the same reason.

export type SupportedExtension = "pdf" | "docx" | "txt" | "md";

const EXTENSION_BY_MIME: Record<string, SupportedExtension> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
};

export class UnsupportedFileTypeError extends Error {
  constructor(public readonly filename: string) {
    super(`"${filename}" is not a supported file type. Upload a PDF, DOCX, TXT, or Markdown file.`);
    this.name = "UnsupportedFileTypeError";
  }
}

export class FileParseError extends Error {
  constructor(filename: string, cause?: unknown, message?: string) {
    super(message ?? `Could not read "${filename}" — it may be corrupted, empty, or password-protected.`);
    this.name = "FileParseError";
    this.cause = cause;
  }
}

/** Resolves a supported extension from filename + MIME type. Extension (suffix) is checked first since browsers send inconsistent MIME types for .md files. */
export function resolveExtension(filename: string, mimeType: string): SupportedExtension | null {
  const suffix = filename.toLowerCase().split(".").pop();
  if (suffix === "pdf" || suffix === "docx" || suffix === "txt" || suffix === "md" || suffix === "markdown") {
    return suffix === "markdown" ? "md" : (suffix as SupportedExtension);
  }
  return EXTENSION_BY_MIME[mimeType] ?? null;
}

/**
 * Extracts plain text from a supported file buffer. Throws
 * UnsupportedFileTypeError (caller's responsibility to check first via
 * resolveExtension) is not thrown here - only genuine parse failures are.
 */
export async function extractText(buffer: Buffer, filename: string, extension: SupportedExtension): Promise<string> {
  try {
    switch (extension) {
      case "txt":
      case "md":
        return buffer.toString("utf-8");

      case "pdf": {
        let PDFParse: typeof import("pdf-parse").PDFParse;
        try {
          ({ PDFParse } = await import("pdf-parse"));
        } catch (importError) {
          throw new FileParseError(
            filename,
            importError,
            `PDF reading is temporarily unavailable on the server. Upload "${filename}" as DOCX, TXT or Markdown instead.`,
          );
        }
        const parser = new PDFParse({ data: buffer });
        try {
          const result = await parser.getText();
          return result.text;
        } finally {
          await parser.destroy();
        }
      }

      case "docx": {
        const mammoth = (await import("mammoth")).default;
        const result = await mammoth.extractRawText({ buffer });
        return result.value;
      }
    }
  } catch (error) {
    if (error instanceof FileParseError) throw error;
    throw new FileParseError(filename, error);
  }
}
