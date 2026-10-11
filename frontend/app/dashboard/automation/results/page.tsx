"use client";

// app/dashboard/automation/results - everything the user's automations concluded.
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { ResultsFeed } from "@/components/automation/ResultsFeed";

export default function AutomationResultsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Automation results"
        description="What your automations concluded, newest first."
        action={
          <Link href="/dashboard/automation" className="text-sm text-text-3 hover:text-text">
            ← Automations
          </Link>
        }
      />
      <ResultsFeed limit={30} showAllLink={false} />
    </div>
  );
}
