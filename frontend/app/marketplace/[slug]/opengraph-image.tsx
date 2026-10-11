// app/marketplace/[slug]/opengraph-image.tsx
// Per-product share card (PNG) used by WhatsApp / Telegram / X link previews. Built from the listing's own public fields
// only: title, platform, asset, price, and the Trust State word exactly as stored (shown only when one exists).
import { ImageResponse } from "next/og";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import ShareCard, { priceLabel, SHARE_CARD_SIZE } from "@/components/marketplace/ShareCard";

export const runtime = "nodejs";
export const revalidate = 300;
export const alt = "AT24 Marketplace listing";
export const size = SHARE_CARD_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await MarketplaceCatalogue.getBySlug(slug).catch(() => null);
  const facts = listing
    ? { title: listing.title, meta: [listing.platformTag, listing.assetTag].filter(Boolean).join("  ·  "), price: priceLabel(listing.pricing), trust: listing.trustState ?? null }
    : { title: "AT24 Marketplace", meta: "Trading systems for MetaTrader", price: null, trust: null };
  return new ImageResponse(<ShareCard f={facts} />, size);
}
