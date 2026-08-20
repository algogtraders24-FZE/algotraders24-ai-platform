// app/marketplace/preview/[id]/page.tsx
// Sprint M12 branding follow-on - lets a seller see their OWN listing
// rendered exactly as ListingDetailView renders a real public listing,
// before it's publicly reachable (publicationState filtering in
// MarketplaceCatalogue.getBySlug means a DRAFT/SUBMITTED/UNDER_REVIEW
// listing 404s at its real /marketplace/<slug> URL - see that file's
// PUBLICLY_VISIBLE_STATES comment). This route deliberately does NOT use
// getBySlug - it uses getByIdForOwner, which checks sellerId ownership
// instead of publicationState, so nothing here ever becomes reachable by a
// non-owner or before the listing is actually published for real.
import { notFound, redirect } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";
import ListingDetailView from "@/components/marketplace/ListingDetailView";

export default async function ListingPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    redirect(`/login?redirect=/marketplace/preview/${id}`);
  }

  const listing = await MarketplaceCatalogue.getByIdForOwner(id, sessionUser.profile.id);
  if (!listing) notFound();

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <div className="px-6 pt-24">
        <div className="max-w-7xl mx-auto rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
          Preview only — publication state is <strong>{listing.publicationState}</strong>. Only you can see this page; it is
          not reachable at its public URL until the listing is READY or PUBLISHED.
        </div>
      </div>
      <ListingDetailView listing={listing} backHref="/marketplace/my-products" backLabel="← Back to My Products" />
      <Footer />
    </main>
  );
}
