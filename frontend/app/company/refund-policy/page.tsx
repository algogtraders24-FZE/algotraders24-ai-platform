import type { Metadata } from "next";
import LegalPageLayout from "@/components/legal/LegalPageLayout";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "When Algotraders24 AI does and does not issue refunds.",
  alternates: { canonical: "/company/refund-policy" },
};

export default function RefundPolicyPage() {
  return (
    <LegalPageLayout
      eyebrow="Company / Legal"
      title="Refund Policy"
      lastUpdated="19 September 2026"
      intro="Marketplace products are digital goods delivered instantly as a signed, device-bound license. Because a license cannot be “returned” the way a physical good can once it has been issued, this policy is deliberately stricter than a typical retail refund policy — and deliberately clear about the real exceptions."
      sections={[
        {
          heading: "Marketplace product purchases",
          body: [
            "All marketplace product sales are final once your license has been issued, except in the cases listed under “When we do refund” below.",
            "We do not offer refunds because a strategy did not perform as you expected, because you changed your mind, or because you did not read the listing's Trust State, Evidence, or Risk Analysis before buying — all of that information is shown on the listing before you pay.",
          ],
        },
        {
          heading: "When we do refund",
          body: [
            "You were charged more than once for the same purchase (duplicate charge) — the duplicate charge is refunded in full.",
            "Payment succeeded but no license was actually issued to your account due to a technical fault on our side, and we could not resolve it — refunded in full.",
            "The product you received is genuinely and materially different from its listing (for example, wrong platform entirely, or the file is corrupted/unusable and the seller cannot provide a working replacement within a reasonable time).",
            "Refund requests under any of the above must be raised within 14 days of purchase, with your order/session reference, via the contact channels below.",
          ],
        },
        {
          heading: "Subscriptions",
          body: [
            "Platform subscription plans can be cancelled anytime; cancellation stops future billing but we do not refund the already-paid current billing period, since you retain full access to the plan's features for that period.",
          ],
        },
        {
          heading: "How refunds are paid",
          body: [
            "Approved refunds are returned to the original payment method via Stripe. Processing time depends on your card issuer or payment method and is typically 5–10 business days after approval.",
          ],
        },
        {
          heading: "Contact us",
          body: [
            "To request a refund, contact us via WhatsApp or Telegram on our Contact page, or by email at billing@algotraders24.ai, with your order reference and the reason for your request.",
          ],
        },
      ]}
    />
  );
}
