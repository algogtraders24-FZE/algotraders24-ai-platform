"use client";
// components/dashboard/ProChartPreview.tsx
// The Pro Chart as the first thing on the dashboard home: a framed, live chart that loads only when it scrolls into view (so the rest of the page is
// not slowed down), with a link to the full-window workstation. Wheel zoom needs Ctrl / Cmd here so the page keeps scrolling.
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const ProChartApp = dynamic(() => import("@/components/chart-engine/ProChartApp"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-text-3">Loading the Pro Chart…</div>,
});

export default function ProChartPreview() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section aria-label="Pro Chart">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-text">Pro Chart</h2>
          <p className="text-sm text-text-2">Live chart with structure, zones and a measured trade plan. Press Analyze; star a symbol to keep it here.</p>
        </div>
        <Link href="/dashboard/chart" className="rounded-control border border-gold/40 bg-gold/10 px-3 py-1.5 text-sm font-semibold text-gold hover:bg-gold/20">Open full Pro Chart</Link>
      </div>
      <div ref={boxRef} className="relative h-[620px] overflow-hidden rounded-panel border border-border bg-[#0b0c10]">
        {visible ? <ProChartApp embedded /> : <div className="flex h-full items-center justify-center text-sm text-text-3">Pro Chart</div>}
      </div>
    </section>
  );
}
