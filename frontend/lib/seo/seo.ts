// lib/seo/seo.ts
// Pure SEO helpers shared by the marketplace, blog and FAQ pages: a clean one-line meta description, absolute URLs, and the
// schema.org JSON-LD for a listing (Product + Offer), breadcrumbs and the FAQ. Only facts that are really on the page go into the
// structured data: no rating, no review count, no availability the system cannot back (a Product with no purchasable release gets no offer).

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai").replace(/\/+$/, "");

export function absoluteUrl(pathOrUrl: string, site: string = SITE_URL): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${site}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** One clean line for <meta name="description">: markdown/HTML/URLs stripped, whitespace collapsed, cut on a sentence or word boundary at `max`. */
export function metaDescription(text: string | null | undefined, fallback: string, max = 155): string {
  const clean = (text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = clean.length >= 40 ? clean : fallback;
  if (base.length <= max) return base;
  const slice = base.slice(0, max);
  const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (sentence >= 80) return slice.slice(0, sentence + 1);
  const word = slice.lastIndexOf(" ");
  return `${slice.slice(0, word > 80 ? word : max - 1).replace(/[,;:\-\s]+$/, "")}…`;
}

const LINE_SEPARATORS = new RegExp(`${String.fromCharCode(0x2028)}|${String.fromCharCode(0x2029)}`, "g");

/** JSON.stringify that is safe inside a <script> tag. */
export function jsonLdString(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(LINE_SEPARATORS, "");
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbJsonLd(items: readonly BreadcrumbItem[], site: string = SITE_URL) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path, site) })),
  };
}

export interface ListingForSeo {
  slug: string;
  title: string;
  description: string;
  sellerName: string | null;
  platformTag: string;
  assetTag: string;
  tags: string[];
  pricing: { model: string; amount?: number; currency?: string; interval?: "month" | "year" };
  releaseId: string | null;
  media: string[];
  updatedAt: string;
}

/** schema.org Product for a public listing. Offer only when there is a price AND a real downloadable release; never a rating or review. */
export function productJsonLd(l: ListingForSeo, site: string = SITE_URL) {
  const url = absoluteUrl(`/marketplace/${l.slug}`, site);
  const category = [l.platformTag, l.assetTag].filter(Boolean).join(" - ");
  const product: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: l.title,
    description: metaDescription(l.description, `${l.title} - a trading system on the AT24 Marketplace.`, 500),
    url,
    ...(l.media.length > 0 ? { image: l.media.map((m) => absoluteUrl(m, site)) } : {}),
    ...(category ? { category } : {}),
    brand: { "@type": "Brand", name: l.sellerName || "Algotraders24 AI" },
  };
  const p = l.pricing;
  const priced = (p.model === "one_time" || p.model === "subscription") && typeof p.amount === "number";
  const free = p.model === "free";
  if ((priced || free) && l.releaseId) {
    const price = free ? 0 : (p.amount as number);
    const offer: Record<string, unknown> = {
      "@type": "Offer",
      url,
      price: price.toFixed(2),
      priceCurrency: p.currency || "USD",
      availability: "https://schema.org/InStock",
      seller: { "@type": "Organization", name: "Algotraders24 AI", url: site },
    };
    if (p.model === "subscription" && p.interval) {
      offer.priceSpecification = { "@type": "UnitPriceSpecification", price: price.toFixed(2), priceCurrency: p.currency || "USD", unitText: p.interval === "year" ? "YEAR" : "MONTH" };
    }
    product.offers = offer;
  }
  return product;
}

export function faqJsonLd(items: ReadonlyArray<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
  };
}
