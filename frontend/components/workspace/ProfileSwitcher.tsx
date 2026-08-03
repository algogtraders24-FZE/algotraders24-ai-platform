"use client";

// components/workspace/ProfileSwitcher.tsx
// Sprint D2.3 (Phase 7) - Workspace Profiles. Switching profile changes only
// the chart's display interval (see PROFILE_INTERVAL) and, later, panel
// layout - it never touches the active symbol or anything AI-related. Built
// on the existing Tabs primitive (components/ui/Tabs.tsx) rather than a new
// control.
import { useWorkspace } from "@/context/WorkspaceContext";
import Tabs, { type TabItem } from "@/components/ui/Tabs";
import { WORKSPACE_PROFILES, type WorkspaceProfile } from "@/types/workspace-preferences";

const PROFILE_LABEL: Record<WorkspaceProfile, string> = {
  default: "Default",
  scalper: "Scalper",
  day_trader: "Day Trader",
  swing_trader: "Swing Trader",
  investor: "Investor",
};

const ITEMS: TabItem[] = WORKSPACE_PROFILES.map((p) => ({ value: p, label: PROFILE_LABEL[p] }));

export default function ProfileSwitcher() {
  const { profile, setProfile } = useWorkspace();
  return (
    <div>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-3">Workspace Profile</span>
      <Tabs items={ITEMS} value={profile} onChange={(v) => setProfile(v as WorkspaceProfile)} className="border-b-0" />
    </div>
  );
}
