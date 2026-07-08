// components/automation/AutomationHistory.tsx
// Execution history table with status and duration.

import type { AutomationRun } from "@/types/automation";
import AutomationStatus from "./AutomationStatus";

export default function AutomationHistory({ runs }: { runs: AutomationRun[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60 text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Workflow</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Started</th>
            <th className="px-4 py-3">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {runs.map((r) => (
            <tr key={r.id} className="hover:bg-slate-900/40">
              <td className="px-4 py-3 font-medium text-slate-100">{r.workflowName}</td>
              <td className="px-4 py-3"><AutomationStatus status={r.status} /></td>
              <td className="px-4 py-3 text-slate-400">{new Date(r.startedAt).toLocaleString()}</td>
              <td className="px-4 py-3 text-slate-400">{r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}</td>
            </tr>
          ))}
          {runs.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-xs text-slate-600">No runs yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}