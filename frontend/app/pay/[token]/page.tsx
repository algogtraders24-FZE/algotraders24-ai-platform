// app/pay/[token]/page.tsx
// Shareable Payment Links - public landing page for a payment-link URL.
// Server Component, calls resolvePaymentLink directly (same convention as
// app/marketplace/[slug]/page.tsx calling MarketplaceCatalogue.getBySlug
// directly rather than self-fetching its own API route). A logged-out
// visitor sees the listing + a login prompt, never a live Buy button - see
// PaymentLinkPurchaseCTA for the login-gated branch.
import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import { getUserOrNull } from "@/lib/auth/protectedRoute";
import { resolvePaymentLink } from "@/services/marketplace/paymentLinkService";
import PaymentLinkPurchaseCTA from "@/components/marketplace/PaymentLinkPurchaseCTA";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const resolved = await resolvePaymentLink(token);
  if ("code" in resolved) return { title: "Payment link | AT24 Marketplace" };
  return { title: `${resolved.listing.title} | AT24 Marketplace` };
}

export default async function PaymentLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [resolved, sessionUser] = await Promise.all([resolvePaymentLink(token), getUserOrNull()]);

  if ("code" in resolved) notFound();
  const { listing } = resolved;

  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="grid gap-8 sm:grid-cols-[1fr_320px]">
          <div>
            <h1 className="text-3xl font-bold">{listing.title}</h1>
            {listing.description && <p className="mt-4 text-sm leading-6 text-text-2">{listing.description}</p>}
          </div>
          <PaymentLinkPurchaseCTA token={token} amount={listing.amount} currency={listing.currency} isLoggedIn={!!sessionUser} />
        </div>
      </div>
      <Footer />
    </main>
  );
}
