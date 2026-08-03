"use client";

// components/workspace/FavoriteMarkets.tsx
// Sprint D2.3 (Phase 7) - Workspace Profiles. Pin/reorder/quick-switch
// favorite symbols, persisted per user (WorkspaceContext handles the
// GET-on-mount hydration and PATCH-on-change persistence). Reorder uses
// simple up/down buttons rather than drag-and-drop - no new dependency for a
// presentation-only nicety. Scoped to listEnabledMarkets(), same as
// GlobalSymbolSelector, so a favorite can never point at a symbol no
// provider serves.
import { useWorkspace } from "@/context/WorkspaceContext";
import { getMarket } from "@/lib/market-data/market-registry";
import Button from "@/components/ui/Button";

export default function FavoriteMarkets() {
  const { symbol, setSymbol, favorites, toggleFavorite, reorderFavorite } = useWorkspace();
  const isFavorite = favorites.includes(symbol);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-text-3">Favorites</span>

      {favorites.length === 0 && <span className="text-xs text-text-3">None pinned yet</span>}

      {favorites.map((fav, i) => {
        const market = getMarket(fav);
        const active = fav === symbol;
        return (
          <div
            key={fav}
            className={`flex items-center gap-1 rounded-control border px-2 py-1 text-xs ${
              active ? "border-gold/60 bg-gold/10 text-gold" : "border-border bg-ink text-text-2"
            }`}
          >
            <button type="button" onClick={() => setSymbol(fav)} className="font-semibold" title={market?.name}>
              {fav}
            </button>
            <button
              type="button"
              aria-label={`Move ${fav} up`}
              disabled={i === 0}
              onClick={() => reorderFavorite(fav, "up")}
              className="text-text-3 hover:text-text disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${fav} down`}
              disabled={i === favorites.length - 1}
              onClick={() => reorderFavorite(fav, "down")}
              className="text-text-3 hover:text-text disabled:opacity-30"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Unpin ${fav}`}
              onClick={() => toggleFavorite(fav)}
              className="text-gold hover:text-gold-strong"
            >
              ×
            </button>
          </div>
        );
      })}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => toggleFavorite(symbol)}
        aria-pressed={isFavorite}
        className="h-7 px-2 text-xs"
      >
        {isFavorite ? "★ Pinned" : "☆ Pin current"}
      </Button>
    </div>
  );
}
