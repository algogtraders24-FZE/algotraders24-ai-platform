import type { Metadata } from "next";
import LegalPageLayout from "@/components/legal/LegalPageLayout";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Algotraders24 AI collects, uses, and protects your data.",
  alternates: { canonical: "/company/privacy-policy" },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      eyebrow="Company / Legal"
      title="Privacy Policy"
      lastUpdated="19 September 2026"
      intro="Algotraders24 AI (“we”, “us”, “Algotraders24”), registered in Ajman Free Zone, UAE, operates algotraders24.ai. This policy explains what data we collect when you use the platform, why, and what control you have over it."
      sections={[
        {
          heading: "Data we collect",
          body: [
            "Account data: your name, email address, and authentication identifiers when you create an account (handled through our authentication provider, Supabase).",
            "Payment data: when you buy a product or subscribe to a plan, payment is processed directly by Stripe, our payment processor. We never see or store your card number, CVC, or full payment details ourselves — we receive only what Stripe confirms was charged (amount, currency, and a transaction reference) so we can issue your purchase.",
            "Product usage data: which features you use (for example, AI Assistant conversations, Market Intelligence queries, Quant Lite backtests, marketplace purchases), so the product works and so we can see what is and isn’t useful.",
            "Technical data: standard web request data (IP address, browser type, pages visited, timestamps) collected automatically by our hosting and security providers (Vercel and Cloudflare) as part of running the site.",
          ],
        },
        {
          heading: "How we use your data",
          body: [
            "To create and operate your account, process your purchases, issue and verify product licenses, and provide the dashboard and AI features you use.",
            "To communicate with you about your account, purchases, or support requests — we do not sell your data or share it with third parties for their own marketing.",
            "To detect and prevent fraud, abuse, and unauthorized access, including on payment and license-issuance flows.",
            "AI Assistant conversations and analysis requests may be processed by our AI model provider (Anthropic) to generate a response; we do not use your conversations to train models ourselves.",
          ],
        },
        {
          heading: "Who we share data with",
          body: [
            "Service providers we rely on to run the platform: Supabase (authentication and database hosting), Stripe (payments), Vercel (application hosting), Cloudflare (network security), and Anthropic (AI model responses). Each only receives the data it needs to perform its function for us.",
            "We do not sell your personal data, and we do not share it with advertisers or data brokers.",
            "We may disclose data if required by law, or to protect the rights, property, or safety of Algotraders24 AI, our users, or the public.",
          ],
        },
        {
          heading: "Data retention",
          body: [
            "We keep account and purchase data for as long as your account is active, and for a reasonable period afterward to meet accounting, tax, and license-verification obligations (buyers may need to prove ownership of a license years after purchase).",
            "You can request deletion of your account and associated personal data at any time by contacting us — see Contact Us below. Some records (for example, completed payment records) may need to be retained longer where required by law.",
          ],
        },
        {
          heading: "Your rights",
          body: [
            "You can access, correct, or request deletion of your personal data by contacting us.",
            "You can withdraw consent for non-essential communications at any time.",
            "Depending on your country of residence, you may have additional rights under local data protection law.",
          ],
        },
        {
          heading: "Contact us",
          body: [
            "For any privacy question or request, reach us via WhatsApp or Telegram on our Contact page, or by email at support@algotraders24.ai.",
          ],
        },
      ]}
    />
  );
}
