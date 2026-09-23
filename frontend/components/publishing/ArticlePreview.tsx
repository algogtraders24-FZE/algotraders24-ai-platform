"use client";

// components/publishing/ArticlePreview.tsx
// Sprint D2.3.S1 - Publishing Activation. Adds the Publish/Schedule actions
// this component never had (Master Audit D2.3.F, Critical finding #1:
// clicking an article only changed local preview state - there was no way
// to actually publish or schedule anything). Also renders the article's
// real history log, satisfying the audit's "History" verification item.
// Sprint UI-03 - hand-rolled rounded-xl recipes -> Card (the p-5 main card
// uses padding="none" + className="p-5" since 5 doesn't land on Card's sm/
// md/lg scale, same technique UI-02.2 established), raw buttons -> Button,
// the datetime-local input -> Input (type passes straight through). Same
// publish/schedule/duplicate handlers throughout.
import { useState } from "react";
import type { Article } from "@/types/article";
import PublishingStatus from "./PublishingStatus";
import Disclaimer from "@/components/ui/Disclaimer";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

interface Props {
  article: Article | null;
  onPublish: (id: string) => void | Promise<void>;
  onSchedule: (id: string, scheduledFor: string) => void | Promise<void>;
  onDuplicate: (id: string) => void | Promise<void>;
}

const ACTION_LABEL: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  scheduled: "Scheduled",
  published: "Published",
  deleted: "Deleted",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function ArticlePreview({ article, onPublish, onSchedule, onDuplicate }: Props) {
  const [scheduledFor, setScheduledFor] = useState("");
  const [busy, setBusy] = useState<"publish" | "schedule" | "duplicate" | null>(null);

  if (!article) {
    return (
      <Card className="text-sm text-text-3">
        Select an article to preview.
      </Card>
    );
  }

  const canAct = article.status === "draft" || article.status === "failed";
  const isPublished = article.status === "published";

  const handlePublish = async () => {
    setBusy("publish");
    try {
      await onPublish(article.id);
    } finally {
      setBusy(null);
    }
  };

  const handleSchedule = async () => {
    if (!scheduledFor) return;
    setBusy("schedule");
    try {
      await onSchedule(article.id, new Date(scheduledFor).toISOString());
    } finally {
      setBusy(null);
    }
  };

  const handleDuplicate = async () => {
    setBusy("duplicate");
    try {
      await onDuplicate(article.id);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card padding="none" className="p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-bold text-text">{article.title}</h2>
        <PublishingStatus status={article.status} />
      </div>
      <p className="mt-1 text-xs text-text-3">/{article.seo.slug}</p>
      <p className="mt-3 text-sm text-text-2">{article.summary}</p>

      <div className="mt-4 space-y-3">
        {article.sections.map((s, i) => (
          <div key={i}>
            <h3 className="text-sm font-semibold text-text">{s.heading}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-text-2">{s.body}</p>
          </div>
        ))}
      </div>

      {/* Sprint D2.3.S4 - article.disclaimer is the persisted, historical value (equal to AI_DISCLAIMER_TEXT for every article, since content-generator.service.ts now sources it from the same constant) - passed through for fidelity rather than re-deriving it. */}
      <Disclaimer text={article.disclaimer} className="mt-4" />

      {canAct && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button size="sm" onClick={handlePublish} loading={busy === "publish"} disabled={busy !== null && busy !== "publish"}>
            Publish now
          </Button>
          <Input
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            style={{ width: "auto" }}
            aria-label="Schedule for"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={handleSchedule}
            loading={busy === "schedule"}
            disabled={(busy !== null && busy !== "schedule") || !scheduledFor}
          >
            Schedule
          </Button>
        </div>
      )}

      {isPublished && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-text-3">Published articles are read-only. Duplicate it to make changes.</p>
          <Button size="sm" variant="secondary" onClick={handleDuplicate} loading={busy === "duplicate"} disabled={busy !== null && busy !== "duplicate"} className="shrink-0">
            Duplicate as Draft
          </Button>
        </div>
      )}

      {article.history.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-3">History</p>
          <ul className="space-y-1">
            {[...article.history].reverse().map((h, i) => (
              <li key={i} className="text-xs text-text-3">
                {ACTION_LABEL[h.action] ?? h.action} — {formatWhen(h.timestamp)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
