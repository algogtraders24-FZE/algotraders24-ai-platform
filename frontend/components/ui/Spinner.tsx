// components/ui/Spinner.tsx
// Sprint D1.0 - The one loading spinner primitive. Used inline in Button
// (loading state) and anywhere else a small in-flow loading indicator is
// needed, replacing ad-hoc "Loading..."/"Signing in..." text-only states.
const SIZE_PX: Record<"sm" | "md" | "lg", number> = { sm: 14, md: 18, lg: 24 };

export default function Spinner({ size = "sm", className = "" }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const px = SIZE_PX[size];
  return (
    <svg
      role="status"
      aria-label="Loading"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      className={`animate-spin ${className}`}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
