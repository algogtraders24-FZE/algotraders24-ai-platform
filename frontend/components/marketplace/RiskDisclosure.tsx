// components/marketplace/RiskDisclosure.tsx
// Sprint M8 - Section 31: mandatory trading-risk disclosure, static and
// identical on every listing. Never a guarantee, never "safe"/"risk-free".
// Deliberately NOT components/ui/Disclaimer.tsx - that component always
// renders the canonical AI_DISCLAIMER_TEXT by design (its own header
// comment: "no `text` override for new call sites"), which is a different
// compliance statement (AI-generated-content disclosure) from this one
// (trading-risk disclosure). Matches its visual treatment without reusing
// its fixed text.
export default function RiskDisclosure() {
  return (
    <p className="border-t border-border pt-3 text-xs text-text-3">
      Trading involves substantial risk of loss and is not suitable for every investor. Past backtested or historical
      performance — verified or otherwise — does not guarantee future results. AT24&apos;s Trust State reflects the state of
      AT24&apos;s evidence about a trading system; it is not a profitability guarantee, a recommendation to buy or use this
      system, or investment advice. No trading system is risk-free.
    </p>
  );
}
