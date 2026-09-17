// app/products/page.tsx
// The legacy static Product catalogue this page rendered had a
// permanently-disabled "Buy Now (Coming Soon)" button (see the removed
// components/product/ProductCTA.tsx) - no real checkout ever existed
// behind it. Every one of those products has since been migrated into
// real MarketplaceListing + ReleaseArtifact rows with a working Stripe
// checkout (same pipeline verified end-to-end for the rest of the
// marketplace), so this route now retires in favor of the one real
// catalogue instead of maintaining two.
import { redirect } from "next/navigation";

export default function ProductsPage() {
  redirect("/marketplace");
}
