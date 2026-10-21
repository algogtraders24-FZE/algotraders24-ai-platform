import type { Metadata } from "next";
import LegalPageLayout from "@/components/legal/LegalPageLayout";

export const metadata: Metadata = {
  title: "AML / KYC Policy",
  description: "Algotraders24 AI's anti-money-laundering and identity-verification approach.",
  alternates: { canonical: "/company/aml-kyc" },
};

export default function AmlKycPage() {
  return (
    <LegalPageLayout
      eyebrow="Company / Legal"
      title="AML / KYC Policy"
      lastUpdated="19 September 2026"
      intro="Algotraders24 AI is a software marketplace and AI intelligence platform — we are not a bank, electronic money institution, or virtual asset service provider, and we do not hold, transmit, or exchange customer funds ourselves."
      sections={[
        {
          heading: "How payments are actually handled",
          body: [
            "Card payments are processed by Stripe, a regulated payment processor that performs its own Know Your Customer (KYC) checks on us as a merchant and runs its own fraud and anti-money-laundering (AML) monitoring on every transaction. We never see or store your full card details.",
            "Where cryptocurrency payment is offered, it is processed through NOWPayments, a third-party crypto payment processor, which performs its own AML screening on transactions before funds reach us.",
            "In both cases, Algotraders24 AI relies on these licensed/regulated processors' own AML and KYC programs rather than running a parallel one of our own — we are a merchant using their services, not a payment institution ourselves.",
          ],
        },
        {
          heading: "When we may ask for identity verification",
          body: [
            "We reserve the right to request proof of identity or proof of payment ownership (for example, for a refund, a large purchase, or a suspected chargeback-fraud pattern) before completing a transaction or issuing a refund.",
            "We may delay, refuse, or reverse a transaction, and suspend the associated account, if our payment processor flags it as suspicious, fraudulent, or in violation of applicable law — this is a real, not hypothetical, control we cooperate with.",
          ],
        },
        {
          heading: "Reporting obligations",
          body: [
            "We comply with applicable UAE law regarding suspicious activity reporting. If we become aware of activity on the platform that appears to be money laundering, terrorist financing, or other financial crime, we will report it to the relevant authority and may be required to freeze or restrict the associated account without prior notice.",
          ],
        },
        {
          heading: "Contact us",
          body: [
            "Questions about this policy: reach us via WhatsApp or Telegram on our Contact page, or by email at security@algotraders24.ai.",
          ],
        },
      ]}
    />
  );
}
