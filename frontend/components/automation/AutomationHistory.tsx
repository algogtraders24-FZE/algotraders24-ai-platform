// components/automation/AutomationHistory.tsx
// Execution history table with status and duration.

import type { AutomationRun } from "@/types/automation";
import AutomationStatus from "./AutomationStatus";

export default function AutomationHistory({ runs }: { runs: AutomationRun[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-ink-2 text-left text-xs uppercase text-text-3">
          <tr>
            <th className="px-4 py-3">Workflow</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Started</th>
            <th className="px-4 py-3">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-ink-2">
              <td className="px-4 py-3 font-medium text-text">{r.workflowName}</td>
              <td className="px-4 py-3"><AutomationStatus status={r.status} /></td>
              <td className="px-4 py-3 text-text-2">{new Date(r.startedAt).toLocaleString()}</td>
              <td className="px-4 py-3 text-text-2">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-text-3">No runs yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}