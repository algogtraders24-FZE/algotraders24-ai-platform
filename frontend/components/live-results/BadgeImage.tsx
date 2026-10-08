// components/live-results/BadgeImage.tsx
// The layout of the shareable Live Results badge (rendered to PNG by next/og, so only flex layouts and
// inline styles are used). Pure presentation of BadgeFacts.
import type { BadgeFacts } from "@/services/live-results/badge";

export const BADGE_W = 720;
export const BADGE_H = 180;
const TONE = { pos: "#3ecf8e", neg: "#ff6b6b", neutral: "#e8ecf5" } as const;

export default function BadgeImage({ f }: { f: BadgeFacts }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", background: "#0b1020", border: "2px solid #2a3350", borderRadius: 18, padding: "20px 26px", color: "#e8ecf5", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", color: "#e3b341", fontSize: 24, fontWeight: 700, letterSpacing: 1 }}>ALGOTRADERS24</div>
          <div style={{ display: "flex", color: "#a3adc4", fontSize: 20, marginLeft: 12 }}>Live Results</div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", border: "2px solid #f5a524", color: "#f5a524", fontSize: 17, fontWeight: 700, borderRadius: 999, padding: "2px 12px" }}>{f.modeLabel}</div>
          <div style={{ display: "flex", border: `2px solid ${f.live ? "#1d6b4c" : "#8a6d1f"}`, color: f.live ? "#3ecf8e" : "#e0b95a", fontSize: 17, borderRadius: 999, padding: "2px 12px", marginLeft: 8 }}>{f.live ? "● live" : "not reporting"}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>{f.title}</div>
        <div style={{ display: "flex", fontSize: 28, fontWeight: 700, color: TONE[f.tone], marginTop: 4 }}>{f.headline}</div>
      </div>
      <div style={{ display: "flex", fontSize: 17, color: "#8590aa" }}>{f.sub}</div>
    </div>
  );
}
