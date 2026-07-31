// app/not-found.tsx
// Sprint R1.0.1 - Next.js App Router convention: automatically rendered for
// any route that doesn't match a real page, and by any notFound() call.
// Sprint D1.0 - Retrofitted onto tokens + ButtonLink (slate-950/indigo ->
// ink/gold).
import ButtonLink from "@/components/ui/ButtonLink";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-6 text-center text-text">
      <p className="text-sm font-semibold uppercase tracking-widest text-gold">404</p>
      <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Page not found</h1>
      <p className="mt-3 max-w-md text-sm text-text-2">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <ButtonLink href="/" size="lg">
          Go to homepage
        </ButtonLink>
        <ButtonLink href="/dashboard" size="lg" variant="secondary">
          Go to dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
