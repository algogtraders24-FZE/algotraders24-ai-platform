// components/brand/SocialIcon.tsx
// Small monochrome logo for a social profile. Instagram, Facebook, X and Telegram use the official path data from
// `simple-icons` (the same package sections/PoweredBy.tsx uses); LinkedIn and YouTube are plain glyphs drawn here. Decorative: the link around it carries the accessible name.
import { siInstagram, siFacebook, siX, siTelegram } from "simple-icons";
import type { SocialProfile } from "@/config/social";

const PATHS: Record<Exclude<SocialProfile["id"], "linkedin" | "youtube">, string> = {
  instagram: siInstagram.path,
  facebook: siFacebook.path,
  x: siX.path,
  telegram: siTelegram.path,
};

export default function SocialIcon({ id, className = "h-4 w-4" }: { id: SocialProfile["id"]; className?: string }) {
  if (id === "youtube") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
        <path d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15V9l5.2 3L10 15Z" />
      </svg>
    );
  }
  if (id === "linkedin") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
        <rect x="2.5" y="2.5" width="19" height="19" rx="3.5" fillOpacity="0.15" />
        <circle cx="7.4" cy="7.6" r="1.5" />
        <rect x="6.1" y="10" width="2.6" height="7.6" />
        <path d="M10.6 10h2.5v1.1c.4-.8 1.4-1.3 2.6-1.3 2.3 0 3.1 1.4 3.1 3.6v4.2h-2.6v-3.8c0-1.1-.3-1.8-1.3-1.8-1.1 0-1.7.8-1.7 1.9v3.7h-2.6V10Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d={PATHS[id]} />
    </svg>
  );
}
