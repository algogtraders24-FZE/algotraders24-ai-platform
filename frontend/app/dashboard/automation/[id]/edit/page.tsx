"use client";

// app/dashboard/automation/[id]/edit - AT24 Automation: edit an existing
// automation's name, schedule, steps and delivery. The server writes a NEW
// definition version; past runs keep the version they executed.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { AutomationDetail } from "@/types/automation";
import { AutomationApi } from "@/services/api/AutomationApi";
import { AutomationBuilder, definitionToDraft } from "@/components/automation/AutomationBuilder";
import PageHeader from "@/components/ui/PageHeader";
import Alert from "@/components/ui/Alert";
import LoadingState from "@/components/ui/LoadingState";

export default function EditAutomationPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AutomationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AutomationApi.get(id).then(setData).catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load automation"));
  }, [id]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Edit automation"
        action={
          <Link href={`/dashboard/automation/${id}`} className="text-sm text-text-3 hover:text-text">
            Cancel
          </Link>
        }
      />
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !data ? (
        <LoadingState />
      ) : data.status === "ARCHIVED" ? (
        <Alert tone="info">An archived automation cannot be edited. Duplicate it to start a new one.</Alert>
      ) : (
        <AutomationBuilder mode="edit" automationId={id} initial={definitionToDraft(data.name, data.description, data.definition)} />
      )}
    </div>
  );
}
