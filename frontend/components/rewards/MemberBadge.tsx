// components/rewards/MemberBadge.tsx
// The diamond shown next to a program member's name. A status marker only (see lib/rewards/badge.ts); the colour is the tier.
import { Gem } from "lucide-react";
import { BADGE_TIERS } from "@/lib/rewards/badge";
import type { RewardProductKey } from "@/lib/rewards/config";

export default function MemberBadge({ tier, dimmed = false, showLabel = true }: { tier: RewardProductKey; dimmed?: boolean; showLabel?: boolean }) {
  const t = BADGE_TIERS[tier];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: t.color, opacity: dimmed ? 0.45 : 1 }} title={dimmed ? `${t.label} (paused)` : t.label}>
      <Gem size={16} aria-hidden="true" />
      {showLabel && <span>{t.label}</span>}
    </span>
  );
}
