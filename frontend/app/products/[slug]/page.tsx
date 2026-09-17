// app/products/[slug]/page.tsx
// See app/products/page.tsx's header comment - this whole route is
// retired in favor of the real marketplace catalogue. Every legacy
// Product slug was migrated 1:1 into a MarketplaceListing with the same
// slug, so this redirect always lands on the equivalent real listing.
import { redirect } from "next/navigation";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/marketplace/${slug}`);
}
