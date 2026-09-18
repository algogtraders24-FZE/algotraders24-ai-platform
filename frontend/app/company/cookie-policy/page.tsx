import type { Metadata } from "next";
import LegalPageLayout from "@/components/legal/LegalPageLayout";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "What cookies Algotraders24 AI uses and why.",
  alternates: { canonical: "/company/cookie-policy" },
};

export default function CookiePolicyPage() {
  return (
    <LegalPageLayout
      eyebrow="Company / Legal"
      title="Cookie Policy"
      lastUpdated="19 September 2026"
      intro="This is a short, honest list of what actually sets cookies on algotraders24.ai today — not a generic template. We keep this deliberately minimal."
      sections={[
        {
          heading: "Essential cookies (always on)",
          body: [
            "Session/authentication cookies, set by our authentication provider (Supabase), keep you signed in as you move between pages on the dashboard. Without these, you would need to log in again on every page.",
            "These cookies are required for the platform to function and cannot be turned off while remaining logged in — they don't track you across other websites.",
          ],
        },
        {
          heading: "What we do not use",
          body: [
            "We do not use third-party advertising cookies, ad-retargeting pixels, or cross-site tracking cookies (for example, no Google Analytics, Facebook Pixel, or similar). If that changes in the future, this page will be updated first and you will be asked for consent where required.",
          ],
        },
        {
          heading: "First-party product analytics",
          body: [
            "We record a small number of product events server-side (for example, that you logged in, or verified your email) to understand how the platform is used and to improve it. This is stored directly in our own database against your account, not via a browser cookie or third-party analytics vendor.",
          ],
        },
        {
          heading: "Managing cookies",
          body: [
            "You can clear or block cookies in your browser settings at any time. Blocking the essential session cookie will sign you out and prevent you from using the authenticated dashboard, but the public marketing pages and Marketplace browsing will still work.",
          ],
        },
        {
          heading: "Contact us",
          body: [
            "Questions about this policy: reach us via WhatsApp or Telegram on our Contact page, or by email at algogtraders24@gmail.com.",
          ],
        },
      ]}
    />
  );
}
