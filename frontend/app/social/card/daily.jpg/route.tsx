// app/social/card/daily.jpg/route.tsx
// The daily range card (1080x1350, 4:5): the 12-hour expected range of every market, from the market hub data. Public image used by
// the social outbox. Returns 404 when fewer than 3 markets have a range (no honest card to show).
import { MARKETS } from "@/services/markets/hub";
import { getMarketHub } from "@/services/markets/production";
import { rangeOnly } from "@/services/social/content";
import { CARD_BG, CARD_GOLD, CARD_MUTED, CARD_TEXT, renderJpeg } from "@/lib/social/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const views = await Promise.all(MARKETS.map((m) => getMarketHub(m).catch(() => null)));
  const rows = views.filter((v): v is NonNullable<typeof v> => !!v && !!v.ranges);
  if (rows.length < 3) return new Response("not enough data", { status: 404 });
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return renderJpeg(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: CARD_BG, color: CARD_TEXT }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 30, color: CARD_GOLD, letterSpacing: 5 }}>ALGOTRADERS24 AI  ·  DAILY RANGE CHECK</div>
        <div style={{ display: "flex", fontSize: 26, color: CARD_MUTED, marginTop: 14 }}>{date}</div>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 700, lineHeight: 1.15, marginTop: 36 }}>How far each market typically moves in the next 12 hours</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((v) => (
          <div key={v.def.slug} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "22px 0", borderTop: "1px solid #232733" }}>
            <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>{v.def.name}</div>
            <div style={{ display: "flex", alignItems: "center", fontSize: 38, color: CARD_TEXT }}>
              {v.ranges?.widenedNote ? <div style={{ display: "flex", fontSize: 24, color: CARD_GOLD, marginRight: 18 }}>US release</div> : null}
              <div style={{ display: "flex" }}>{rangeOnly(v.ranges!.r12)}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", fontSize: 24, color: CARD_MUTED }}>
        <div style={{ display: "flex" }}>About 80% of past moves stayed within these ranges. A volatility range, not a direction or a target.</div>
        <div style={{ display: "flex", marginTop: 10, color: CARD_GOLD }}>algotraders24.ai/markets  ·  Not financial advice</div>
      </div>
    </div>,
    1080,
    1350,
  );
}
