// components/marketplace/ShareCard.tsx
// The 1200x630 link-preview card of a marketplace listing (rendered to PNG by next/og). Public listing fields only.
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

export interface ShareCardFacts {
  title: string;
  meta: string;
  price: string | null;
  trust: string | null;
  /** data: URI of the listing's icon, or null. */
  logo?: string | null;
}

export function priceLabel(p: { amount?: number; currency?: string; interval?: string }): string | null {
  if (typeof p.amount !== "number") return null;
  const cur = p.currency ?? "USD";
  const amount = Number.isInteger(p.amount) ? String(p.amount) : p.amount.toFixed(2);
  return `${cur === "USD" ? "$" : ""}${amount}${cur === "USD" ? "" : ` ${cur}`}${p.interval ? ` / ${p.interval}` : ""}`;
}

export default function ShareCard({ f }: { f: ShareCardFacts }) {
  const title = f.title.slice(0, 80);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#0b0d12", color: "#f3f4f6" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 30, color: "#d4a73c", letterSpacing: 4 }}>AT24 MARKETPLACE</div>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        {f.logo ? <img src={f.logo} width={140} height={140} style={{ borderRadius: 24, objectFit: "cover" }} /> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: title.length > 40 ? 56 : 72, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
        <div style={{ display: "flex", fontSize: 32, color: "#9ca3af", marginTop: 24 }}>{f.meta}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 40, color: "#d4a73c", fontWeight: 700 }}>{f.price ?? ""}</div>
        <div style={{ display: "flex", fontSize: 26, color: "#9ca3af" }}>{f.trust ? `Trust State: ${f.trust}   ·   ` : ""}algotraders24.ai</div>
      </div>
    </div>
  );
}
