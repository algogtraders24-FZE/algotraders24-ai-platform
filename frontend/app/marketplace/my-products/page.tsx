// app/marketplace/my-products/page.tsx
// Sprint M9 - Seller dashboard extension: "My Products" (M9 brief). Shows
// each of the caller's own listings' Submission/Trust/Evidence/Validation/
// Risk/Publication state, with SELLER CONTENT vs AT24 VERIFIED visually
// separated (M9 brief) - see MyProductsClient's own layout.
import Link from "next/link";
import { requireUser } from "@/lib/auth/protectedRoute";
import MyProductsClient from "./MyProductsClient";

export const metadata = {
  title: "My Products | AT24 Marketplace",
};

export default async function MyProductsPage() {
  await requireUser("/login?redirect=/marketplace/my-products");

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text sm:text-3xl">My Products</h1>
          <p className="mt-1 text-sm text-text-2">Your own submissions. AT24-verified fields are always shown separately from your own text.</p>
        </div>
        <Link href="/marketplace/sell" className="text-sm font-semibold text-gold hover:underline">
          + New submission
        </Link>
      </header>
      <MyProductsClient />
    </div>
  );
}
