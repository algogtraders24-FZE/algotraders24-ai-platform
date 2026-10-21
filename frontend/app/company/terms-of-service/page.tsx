import type { Metadata } from "next";
import LegalPageLayout from "@/components/legal/LegalPageLayout";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of Algotraders24 AI.",
  alternates: { canonical: "/company/terms-of-service" },
};

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout
      eyebrow="Company / Legal"
      title="Terms of Service"
      lastUpdated="19 September 2026"
      intro="These terms govern your use of algotraders24.ai, operated by Algotraders24 AI, registered in Ajman Free Zone, UAE. By creating an account or using the platform, you agree to them."
      sections={[
        {
          heading: "The platform",
          body: [
            "Algotraders24 AI provides an AI-driven market intelligence and trading-education platform (AI Assistant, Market Intelligence, Quant Lite strategy building, Trading Copilot, and related tools), and a marketplace where independent sellers list trading algorithms, indicators, and bots (“products”) for purchase.",
            "We are a technology and marketplace platform — we are not a broker, not an investment adviser, and do not manage client funds or execute trades on your behalf.",
          ],
        },
        {
          heading: "No investment advice, no profitability guarantee",
          body: [
            "Nothing on this platform — AI Assistant output, Market Intelligence analysis, Trading Copilot suggestions, or any marketplace product listing — is financial, investment, or trading advice. It is provided for informational and educational purposes only.",
            "Trading financial instruments carries substantial risk, including the risk of losing your entire investment. Past or backtested performance, whether from our platform or a marketplace seller's own claims, does not guarantee future results.",
            "You are solely responsible for your own trading decisions and for evaluating any product, analysis, or strategy before acting on it.",
          ],
        },
        {
          heading: "Marketplace purchases and licenses",
          body: [
            "Each marketplace product is sold under a one-time purchase that grants you a personal, non-transferable, non-exclusive license to use that product, valid for the number of active devices stated on the listing at the time of purchase (typically one).",
            "Buying a product does not transfer ownership of the underlying code, strategy logic, or intellectual property to you — sellers retain full ownership. You may not resell, redistribute, decompile, or share a purchased product outside the terms of your license.",
            "“Trust State” badges (for example VALIDATED, UNVERIFIED, LIMITED) shown on a listing reflect the state of Algotraders24 AI's own independent evidence review of that product at the time shown — they are not a guarantee of profitability or a recommendation to buy.",
            "Sellers are independent third parties responsible for the accuracy of their own listing descriptions. Algotraders24 AI reviews evidence submitted for validation but does not author, test-trade, or guarantee seller-authored marketing copy.",
          ],
        },
        {
          heading: "Subscriptions",
          body: [
            "Platform subscription plans (where offered) renew automatically at the end of each billing period until cancelled. You can cancel anytime from your dashboard; cancellation takes effect at the end of the current billing period, and no partial-period refund is given except as described in our Refund Policy.",
          ],
        },
        {
          heading: "Acceptable use",
          body: [
            "You agree not to: attempt to circumvent license checks or payment; reverse-engineer, redistribute, or resell any product or platform feature without authorization; use the platform for any unlawful purpose; or attempt to disrupt, overload, or gain unauthorized access to our systems.",
            "We may suspend or terminate accounts that violate these terms, engage in fraud (including payment fraud or chargebacks made in bad faith), or abuse the platform.",
          ],
        },
        {
          heading: "Intellectual property",
          body: [
            "The Algotraders24 AI platform, brand, and all AI Assistant/Market Intelligence/Quant Lite functionality are our intellectual property. Marketplace product code and strategy logic belong to their respective sellers.",
          ],
        },
        {
          heading: "Limitation of liability",
          body: [
            "To the maximum extent permitted by law, Algotraders24 AI is not liable for any trading losses, lost profits, or indirect or consequential damages arising from your use of the platform, any AI-generated output, or any marketplace product.",
            "Our total liability to you for any claim arising from these terms or your use of the platform is limited to the amount you paid us in the 12 months before the claim arose.",
          ],
        },
        {
          heading: "Governing law",
          body: [
            "These terms are governed by the laws of the United Arab Emirates, without regard to conflict-of-law principles. Any dispute will be subject to the exclusive jurisdiction of the competent courts of the UAE, unless mandatory local consumer-protection law in your own country provides otherwise.",
          ],
        },
        {
          heading: "Changes to these terms",
          body: [
            "We may update these terms from time to time. Continued use of the platform after a change is posted means you accept the updated terms. Material changes will be reflected in the “Last updated” date above.",
          ],
        },
        {
          heading: "Contact us",
          body: [
            "For any question about these terms, reach us via WhatsApp or Telegram on our Contact page, or by email at support@algotraders24.ai.",
          ],
        },
      ]}
    />
  );
}
