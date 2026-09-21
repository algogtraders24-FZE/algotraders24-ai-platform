// components/auth/TurnstileWidget.tsx
// Sprint R1.3 - Renders the Cloudflare Turnstile challenge inside the signup
// form. Submits its token as "cf-turnstile-response" (Turnstile's default
// field name), which the server action reads and verifies via
// lib/security/turnstile.ts. Renders nothing when no site key is configured,
// so signup keeps working (backed by rate limiting + honeypot alone) until
// real Cloudflare keys are added.
"use client";

import Script from "next/script";

export default function TurnstileWidget() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;

  return (
    <div>
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      <div className="cf-turnstile" data-sitekey={siteKey} data-theme="dark" />
    </div>
  );
}
