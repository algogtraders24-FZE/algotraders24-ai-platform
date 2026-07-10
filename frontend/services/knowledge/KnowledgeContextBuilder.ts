// services/knowledge/KnowledgeContextBuilder.ts
// Assembles retrieved documents into a context block for a future RAG call.

import type { SearchResult, KnowledgeContext } from "@/types/knowledge";
import { KNOWLEDGE_CONFIG } from "@/config/knowledge.config";

export function buildContext(query: string, results: SearchResult[]): KnowledgeContext {
  let contextText = "";

  for (const r of results) {
    const block = `# ${r.document.title}\n${r.document.description}\nTags: ${r.document.tags.join(", ")}\n\n`;
    if (contextText.length + block.length > KNOWLEDGE_CONFIG.maxContextChars) break;
    contextText += block;
  }

  return { query, documents: results, contextText: contextText.trim() };
}