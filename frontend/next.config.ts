import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sprint M12 branding follow-on - MarketplaceCatalogue.ts and
  // mt5EvidenceAdapter.ts both read data/marketplace-evidence/*.json via a
  // runtime-computed filename (readFileSync(join(dir, `${id}.json`))).
  // Next's automatic serverless-function file tracer only detects
  // statically-analyzable fs paths, not dynamically-built ones, so it was
  // silently dropping this directory from the deployed bundle - files
  // that exist and work locally, 404/ENOENT (caught, returns null) in
  // production. This explicit include is the documented fix (see
  // node_modules/next/dist/docs/.../output.md's own "Next.js might fail
  // to include required files" section).
  // AT24 Security Hardening P0 - app/api/private/licenses/[licenseId]/download/route.ts
  // reads paid EA binaries via path.join(process.cwd(), "private-releases", `${release.id}.ex5`)
  // - the exact same dynamically-computed-path problem as marketplace-evidence
  // above. Without this, buyers' paid downloads 404/500 in production even
  // though the .ex5 files are committed to the repo.
  outputFileTracingIncludes: {
    "/*": ["data/marketplace-evidence/**/*", "private-releases/**/*"],
  },

  // AT24 Security Hardening P1.2 - baseline security response headers.
  // Content-Security-Policy: script-src includes 'unsafe-inline' - NOT
  // the first choice. A per-request nonce (Next's own documented pattern,
  // proxy.ts, incl. 'strict-dynamic') was implemented and tested three
  // separate ways - Turbopack on a static page, Turbopack on a genuinely
  // dynamic page, and a webpack-fallback build - all three failed
  // identically: Next 16.3.6 does not attach the nonce to its own
  // generated <script> tags (inline bootstrap AND external chunks
  // alike), confirmed by actually running `next start` each time, not
  // just `next build`. This matches a known, upstream-confirmed Next.js
  // bug closed "not planned" by the framework team:
  // https://github.com/vercel/next.js/issues/96063 - its own root-cause
  // note: "the nonce value from the CSP request header is never
  // propagated into the HTML output, despite proper middleware
  // implementation following Next.js documentation." That issue's own
  // documented workaround is this same 'unsafe-inline' fallback.
  // Every other directive is unweakened: script-src still allows only
  // 'self' + Cloudflare Turnstile + TradingView (no arbitrary third-party
  // script origin), object-src/base-uri/form-action/frame-ancestors stay
  // fully locked down. What's lost is CSP's protection against a
  // hypothetical FUTURE inline-script XSS bug - this app has zero known
  // XSS vectors today (confirmed in the P1 security audit: React
  // auto-escapes everywhere, the only dangerouslySetInnerHTML is static
  // JSON-LD). style-src's 'unsafe-inline' was already unavoidable - 26
  // files use React's inline `style={{...}}` prop.
  //
  // img-src's Supabase Storage host serves the marketplace-media bucket
  // (lib/marketplace/mediaStorage.ts); if the Supabase project URL ever
  // changes, this value must be updated to match. frame-src's Turnstile
  // origin covers the internal iframe Turnstile's own script creates for
  // the CAPTCHA widget (this app never writes an <iframe> itself).
  // frame-ancestors 'none' is the CSP-native clickjacking defense used
  // here instead of X-Frame-Options - no page in this app is ever
  // legitimately embedded in another site's frame.
  //
  // Cloudflare fronts this deployment and already injects HSTS at the edge
  // - the header below is an intentional, harmless duplicate for when the
  // app is ever served without Cloudflare in front (e.g. a preview
  // deployment), not a fix for a live gap.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://s3.tradingview.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://gyiwxsxgnnigoqpedzfw.supabase.co; connect-src 'self'; frame-src https://challenges.cloudflare.com; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
