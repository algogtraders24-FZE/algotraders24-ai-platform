"use client";
// components/product/ProductViewTracker.tsx
// Sprint R1.2 - Phase 2: real "product_view" event. Renders nothing - a
// client component so the event fires once per real page load in the
// visitor's browser, not once per ISR revalidation of the (cached) Server
// Component page it's mounted in (app/products/[slug]/page.tsx revalidates
// every 300s and is shared across every visitor in that window - firing
// from inside that Server Component would count renders, not views).
import { useEffect } from "react";
import { AnalyticsApi } from "@/services/api/AnalyticsApi";

export default function ProductViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    AnalyticsApi.report("product_view", { slug });
  }, [slug]);

  return null;
}
