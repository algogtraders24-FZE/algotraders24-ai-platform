// components/knowledge/KnowledgeUploader.tsx
// Sprint L2.2 - Real file upload with real client-side validation and real
// server errors surfaced verbatim.
// Sprint D1.0 - Retrofitted onto Card/Select/Button + tokens (indigo-600
// button/slate chrome -> gold/ink).
"use client";

import { useState } from "react";
import { KNOWLEDGE_CATEGORIES } from "@/config/knowledge.config";
import type { KnowledgeCollection } from "@/types/knowledge";
import Card from "@/components/ui/Card";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";

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
    <Card padding="sm">
      <p className="mb-3 text-sm font-semibold text-text-2">Upload Document</p>
      <div className="space-y-2">
        <input
          type="file"
          accept={ACCEPTED}
          onChange={handleFileChange}
          disabled={uploading}
          className="block w-full text-xs text-text-3 file:mr-3 file:rounded-control file:border-0 file:bg-ink-3 file:px-3 file:py-2 file:text-xs file:font-medium file:text-text-2 hover:file:bg-ink-4 disabled:opacity-50"
        />
        <p className="text-[10px] text-text-3">PDF, DOCX, TXT, or Markdown — up to 15MB.</p>

        <div className="grid grid-cols-2 gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} disabled={uploading}>
            {KNOWLEDGE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
          <Select value={collectionId} onChange={(e) => setCollectionId(e.target.value)} disabled={uploading}>
            <option value="">No collection</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>

        {(localError || error) && <p className="text-xs text-danger">{localError ?? error}</p>}

        <Button onClick={submit} loading={uploading} fullWidth>
          {uploading ? "Uploading & indexing…" : "Upload & Index"}
        </Button>
      </div>
    </Card>
  );
}
