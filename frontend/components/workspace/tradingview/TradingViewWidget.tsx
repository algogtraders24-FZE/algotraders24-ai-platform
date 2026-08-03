"use client";

// components/workspace/tradingview/TradingViewWidget.tsx
// Sprint D2.3 (Phase 5, height tuned in a later pass) - the single reusable
// TradingView wrapper. No page embeds TradingView directly; they compose
// this. Two rules are enforced here:
//   1. LAZY: the (heavy) TradingView embed script is only injected once the
//      widget scrolls near the viewport (IntersectionObserver), never on
//      initial page load.
//   2. ATTRIBUTION: the official TradingView copyright link is always rendered
//      inside the container, as required by their embed terms.
// Height is responsive (Tailwind classes, not a single inline px value) so
// callers can give the chart more room on desktop without wasting space on
// small screens. `reserveClassName` must be `heightClassName` plus room for
// the attribution line below the chart, so the pre-mount placeholder is the
// same height as the mounted widget at every breakpoint (CLS-safe). Callers
// remount on symbol change via a React `key`, so this effect stays simple
// (inject once per mount).
import { useEffect, useRef, useState } from "react";

export interface TradingViewWidgetProps {
  /** TradingView external-embedding script URL for the specific widget. */
  scriptSrc: string;
  /** Widget configuration object (serialized into the script body). */
  config: Record<string, unknown>;
  /** Responsive Tailwind height classes for the chart itself, e.g. "h-[320px] sm:h-[420px] lg:h-[500px]". */
  heightClassName: string;
  /** Responsive Tailwind height classes for the outer reserved placeholder — `heightClassName` plus room for the attribution line, so mounting never shifts the layout. */
  reserveClassName: string;
}

export default function TradingViewWidget({ scriptSrc, config, heightClassName, reserveClassName }: TradingViewWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // 1. Load-on-visible.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "250px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  // 2. Inject the widget (with attribution) once visible.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || !visible) return;

    node.innerHTML = "";
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";

    const widget = document.createElement("div");
    widget.className = `tradingview-widget-container__widget ${heightClassName}`;

    // Required TradingView attribution — must be preserved.
    const copyright = document.createElement("div");
    copyright.className = "tradingview-widget-copyright";
    copyright.style.fontSize = "11px";
    copyright.style.padding = "6px 2px 0";
    copyright.innerHTML =
      '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank" style="color:#7b889b;text-decoration:none">Track all markets on TradingView</a>';

    const script = document.createElement("script");
    script.src = scriptSrc;
    script.async = true;
    script.type = "text/javascript";
    script.innerHTML = JSON.stringify(config);

    container.appendChild(widget);
    container.appendChild(copyright);
    container.appendChild(script);
    node.appendChild(container);

    return () => {
      node.innerHTML = "";
    };
    // Injection is per-mount; callers remount (key) to change symbol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return <div ref={containerRef} className={`w-full ${reserveClassName}`} />;
}
