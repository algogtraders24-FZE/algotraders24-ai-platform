// app/marketplace/preview/homepage/page.tsx
// Sprint M12 branding follow-on - shows what the REAL homepage
// (app/page.tsx) would look like with FeaturedProducts swapped for a
// Marketplace-sourced section, using the caller's own real listings.
// Owner-gated the same way as app/marketplace/preview/[id]/page.tsx - this
// does NOT change app/page.tsx itself, which still renders FeaturedProducts
// untouched. Swapping the real homepage is a separate, explicit decision
// (it's a public, permanent content change affecting every visitor) - this
// route only lets you see the alternative before deciding.
import { redirect } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Hero from "@/sections/Hero";
import TrustStrip from "@/sections/TrustStrip";
import PlatformOverview from "@/sections/PlatformOverview";
import FeaturedMarketplacePreview from "@/sections/FeaturedMarketplacePreview";
import PricingTeaser from "@/sections/PricingTeaser";
import FAQ from "@/sections/FAQ";
import CTA from "@/sections/CTA";
import Footer from "@/sections/Footer";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { MarketplaceCatalogue } from "@/services/marketplace/MarketplaceCatalogue";

export default async function HomepagePreviewPage() {
  const sessionUser = await getUserOrNull();
  if (!sessionUser) {
    redirect("/login?redirect=/marketplace/preview/homepage");
  }

  const listings = await MarketplaceCatalogue.listAllForOwner(sessionUser.profile.id);

  return (
    <main id="main-content" className="min-h-screen bg-ink text-text">
      <div className="px-6 pt-6">
        <div className="max-w-7xl mx-auto rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
          Preview only — this is NOT the live homepage. It shows your own listing(s) in place of Featured Products so you
          can see how it would look; app/page.tsx is untouched.
        </div>
      </div>
      <Navbar />
      <Hero />
      <TrustStrip />
      <PlatformOverview />
      {listings.length > 0 ? (
        <FeaturedMarketplacePreview listings={listings} />
      ) : (
        <div className="max-w-7xl mx-auto px-6 py-16 text-center text-text-3">No listings yet.</div>
      )}
      <PricingTeaser />
      <FAQ limit={5} />
      <CTA />
      <Footer />
    </main>
  );
}
