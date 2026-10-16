// app/social/card/scoreboard.jpg/route.tsx
// The weekly calibration scoreboard card (1080x1080): the pooled live hit rate of the stated ranges. A horizon with fewer than 30
// checked forecasts says "collecting", never a percentage dressed up as a result. 404 when nothing has been checked yet.
import { readScoreboard } from "@/services/calibration/production";
import { MIN_SAMPLE, TARGET_COVERAGE } from "@/services/calibration/forecast";
import { CARD_BG, CARD_GOLD, CARD_MUTED, CARD_TEXT, renderJpeg } from "@/lib/social/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const board = await readScoreboard();
  const rows = board.all.filter((r) => r.n > 0);
  if (rows.length === 0) return new Response("nothing checked yet", { status: 404 });
  return renderJpeg(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: CARD_BG, color: CARD_TEXT }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 30, color: CARD_GOLD, letterSpacing: 5 }}>ALGOTRADERS24 AI  ·  LIVE SCOREBOARD</div>
        <div style={{ display: "flex", fontSize: 66, fontWeight: 700, lineHeight: 1.1, marginTop: 40 }}>Do our ranges hold up?</div>
        <div style={{ display: "flex", fontSize: 28, color: CARD_MUTED, marginTop: 20 }}>We state a range, then check it. Every forecast counts.</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r) => (
          <div key={r.horizon} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "26px 0", borderTop: "1px solid #232733" }}>
            <div style={{ display: "flex", fontSize: 40 }}>{r.horizon}-hour ranges</div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ display: "flex", fontSize: 58, fontWeight: 700, color: r.status === "collecting" ? CARD_MUTED : CARD_GOLD }}>{r.status === "collecting" ? "collecting" : `${Math.round((r.rate ?? 0) * 100)}%`}</div>
              <div style={{ display: "flex", fontSize: 24, color: CARD_MUTED }}>{r.status === "collecting" ? `${r.n} checked, need ${MIN_SAMPLE}` : `stayed inside, ${r.n} checked, target ${TARGET_COVERAGE * 100}%`}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", fontSize: 24, color: CARD_GOLD }}>algotraders24.ai/calibration  ·  Not financial advice</div>
    </div>,
    1080,
    1080,
  );
}
