// components/knowledge/KnowledgeUploader.tsx
"use client";

import { useState } from "react";
import { KNOWLEDGE_CATEGORIES, KNOWLEDGE_COLLECTIONS } from "@/config/knowledge.config";

interface Props {
  onUpload: (title: string, category: string, collection: string) => void;
}

export default function KnowledgeUploader({ onUpload }: Props) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>(KNOWLEDGE_CATEGORIES[0]);
  const [collection, setCollection] = useState<string>(KNOWLEDGE_COLLECTIONS[0]);

  const submit = () => {
    if (!title.trim()) return;
    onUpload(title.trim(), category, collection);
    setTitle("");
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <p className="mb-3 text-sm font-semibold text-slate-300">Upload Document</p>
      <div className="space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Document title"
          className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50">
            {KNOWLEDGE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={collection} onChange={(e) => setCollection(e.target.value)} className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50">
            {KNOWLEDGE_COLLECTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={submit} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Add to Library</button>
      </div>
    </div>
  );
}