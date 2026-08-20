// components/marketplace/MarketplaceFilters.tsx
// Sprint M8 - Search + Platform/Asset/Strategy/Trust-State filters + sort.
// Every option here maps to a real server-side query param
// (MarketplaceCatalogue.search) - no client-side-only filtering of a
// pre-fetched array (M8 brief section 22). Sort options deliberately
// exclude any profitability-based sort (section 20).
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import {
  ASSET_FILTERS,
  PLATFORM_FILTERS,
  SORT_OPTIONS,
  STRATEGY_FILTERS,
  TRUST_STATES,
} from "@/types/marketplace";
import { trustStateLabel } from "@/lib/marketplace";
import type { MarketplaceSearchParams } from "@/types/marketplace";

export interface MarketplaceFiltersValue {
  q: string;
  platform: string;
  asset: string;
  strategy: string;
  trustState: string;
  sort: NonNullable<MarketplaceSearchParams["sort"]>;
}

export const DEFAULT_FILTERS: MarketplaceFiltersValue = {
  q: "",
  platform: "",
  asset: "",
  strategy: "",
  trustState: "",
  sort: "newest",
};

export default function MarketplaceFilters({
  value,
  onChange,
}: {
  value: MarketplaceFiltersValue;
  onChange: (next: MarketplaceFiltersValue) => void;
}) {
  const set = <K extends keyof MarketplaceFiltersValue>(key: K, v: MarketplaceFiltersValue[K]) => onChange({ ...value, [key]: v });

  return (
    <div className="flex flex-col gap-3">
      <Input
        value={value.q}
        onChange={(e) => set("q", e.target.value)}
        placeholder="Search trading systems, platforms, strategies..."
        aria-label="Search marketplace"
        className="w-full"
      />
      <div className="flex flex-wrap gap-3">
        <Select aria-label="Filter by platform" value={value.platform} onChange={(e) => set("platform", e.target.value)}>
          <option value="">All platforms</option>
          {PLATFORM_FILTERS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </Select>
        <Select aria-label="Filter by asset" value={value.asset} onChange={(e) => set("asset", e.target.value)}>
          <option value="">All assets</option>
          {ASSET_FILTERS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
        <Select aria-label="Filter by strategy" value={value.strategy} onChange={(e) => set("strategy", e.target.value)}>
          <option value="">All strategies</option>
          {STRATEGY_FILTERS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select aria-label="Filter by trust state" value={value.trustState} onChange={(e) => set("trustState", e.target.value)}>
          <option value="">All trust states</option>
          {TRUST_STATES.map((t) => (
            <option key={t} value={t}>{trustStateLabel(t)}</option>
          ))}
        </Select>
        <Select aria-label="Sort by" value={value.sort} onChange={(e) => set("sort", e.target.value as MarketplaceFiltersValue["sort"])}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Select>
      </div>
    </div>
  );
}
