// sections/Footer.tsx
// Sprint H1.3 - Rebuilt per the approved Sprint H1.1 audit and H1.2A
// design system: every link resolves to a real page (no href="#"
// placeholders, no invented "AI Academy"/"Careers"/"Blog" destinations
// that don't exist), and no fabricated statistics, testimonials, or trust
// indicators - the risk disclosure line is real, plain text, not a link.
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-border bg-ink pt-12 pb-8 text-text md:pt-16">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <h3 className="text-lg font-semibold">
              Algotraders<span className="text-gold">24</span> AI
            </h3>
            <p className="mt-4 max-w-sm text-sm leading-6 text-text-2">
              An AI Trading Intelligence Platform — deterministic, evidence-based market analysis, explained in
              plain language.
            </p>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold">Product</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/products" className="text-text-2 transition-colors hover:text-gold">
                  All Products
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="mb-4 text-sm font-semibold">Account</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link href="/login" className="text-text-2 transition-colors hover:text-gold">
                  Sign In
                </Link>
              </li>
              <li>
                <Link href="/signup" className="text-text-2 transition-colors hover:text-gold">
                  Create Account
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-border pt-8 md:flex-row">
          <p className="text-sm text-text-3">© 2026 Algotraders24 AI. All rights reserved.</p>
          <p className="max-w-2xl text-center text-xs text-text-3 md:text-right">
            Trading involves risk. Past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </footer>
  );
}
