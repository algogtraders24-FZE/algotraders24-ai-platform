// components/knowledge/KnowledgeUploader.tsx
// Sprint L2.2 - Real file upload. Previously a title-only text field whose
// submit handler was explicitly commented "Simulated upload" - this is a
// real <input type="file">, real client-side validation (file chosen,
// size, extension), and real server errors surfaced verbatim rather than
// hidden behind a fake success state.
"use client";

import { useState } from "react";
import { KNOWLEDGE_CATEGORIES } from "@/config/knowledge.config";
import type { KnowledgeCollection } from "@/types/knowledge";

const ACCEPTED = ".pdf,.docx,.txt,.md,.markdown";
const MAX_BYTES = 15 * 1024 * 1024;

interface Props {
  collections: KnowledgeCollection[];
  uploading: boolean;
  error: string | null;
  onUpload: (file: File, category: string, collectionId?: string) => void;
}

export default function KnowledgeUploader({ collections, uploading, error, onUpload }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<string>(KNOWLEDGE_CATEGORIES[0]);
  const [collectionId, setCollectionId] = useState<string>("");
  const [localError, setLocalError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    setLocalError(null);
    if (chosen && chosen.size > MAX_BYTES) {
      setFile(null);
      setLocalError(`"${chosen.name}" exceeds the 15MB limit`);
      return;
    }
    setFile(chosen);
  };

  const submit = () => {
    if (!file) {
      setLocalError("Choose a file first");
      return;
    }
    setLocalError(null);
    onUpload(file, category, collectionId || undefined);
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Upload Document</p>
      <div className="space-y-2">
        <input
          type="file"
          accept={ACCEPTED}
          onChange={handleFileChange}
          disabled={uploading}
          className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-200 hover:file:bg-slate-700 disabled:opacity-50"
        />
        <p className="text-[10px] text-slate-600">PDF, DOCX, TXT, or Markdown — up to 15MB.</p>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={uploading}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
          >
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            disabled={uploading}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
          >
            <option value="">No collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {(localError || error) && <p className="text-xs text-red-400">{localError ?? error}</p>}

        <button
          onClick={submit}
          disabled={uploading}
          className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {uploading ? "Uploading & indexing…" : "Upload & Index"}
        </button>
      </div>
    </div>
  );
}
