"use client";

// app/dashboard/chart/page.tsx - Pro Chart: the native chart in Professional Mode layout as a full-window workstation
// (left rail, one-row top bar, footer, right panel with the trade plan, chat, trade and strategies).
import ProChartApp from "@/components/chart-engine/ProChartApp";

export default function ProChartPage() {
  return (
    <div className="fixed inset-0 z-[60] bg-[#0b0c10]">
      <ProChartApp />
    </div>
  );
}
