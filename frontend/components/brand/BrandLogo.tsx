// components/brand/BrandLogo.tsx
// Brand Identity v1.0 - renders the OFFICIAL approved logo assets from the
// Brand Assets package (frontend/Brand Assets), NOT a recreation:
//   /brand/algotraders24-mark.svg    - the official infinity mark (symbol)
//   /brand/algotraders24-lockup.svg  - the official full stacked lockup
//     (mark + ALGOTRADERS24 AI + descriptor)
// Both are the supplied master SVG used directly; only the opaque backing
// plate was removed so the artwork sits on any surface. The logo itself is
// never redrawn.
//
// - "full"    : official mark + wordmark set in the brand typeface (Urbanist),
//               for horizontal chrome (nav, sidebar, footer)
// - "stacked" : the official full lockup SVG (mark + wordmark + descriptor)
// - "icon"    : the official mark only (compact / mobile / avatar)

export type BrandVariant = "full" | "stacked" | "icon";

export interface BrandLogoProps {
  variant?: BrandVariant;
  size?: "sm" | "md";
  className?: string;
  /** Retained for API compatibility; the official lockup always ships its
   *  descriptor, so this only affects the horizontal "full" wordmark. */
  withDescriptor?: boolean;
}

const MARK_SRC = "/brand/algotraders24-mark.svg";
const LOCKUP_SRC = "/brand/algotraders24-lockup.svg";

export default function BrandLogo({ variant = "full", size = "md", className = "" }: BrandLogoProps) {
  const markH = size === "sm" ? "h-7" : "h-9";
  const wordSize = size === "sm" ? "text-lg" : "text-2xl";

  if (variant === "stacked") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={LOCKUP_SRC}
        alt="Algotraders24 AI — AI Trading Intelligence Platform"
        className={`${className || "h-24"} w-auto`}
      />
    );
  }

  if (variant === "icon") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={MARK_SRC} alt="Algotraders24 AI" className={`${className || "h-8"} w-auto`} />
    );
  }

  // full (horizontal): official mark + wordmark in the brand typeface
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={MARK_SRC} alt="" aria-hidden="true" className={`${markH} w-auto shrink-0`} />
      <span
        className={`${wordSize} font-bold leading-none tracking-tight text-text`}
        style={{ fontFamily: "var(--font-urbanist), 'Urbanist', system-ui, sans-serif" }}
      >
        ALGOTRADERS<span className="text-gold">24</span> AI
      </span>
    </span>
  );
}
