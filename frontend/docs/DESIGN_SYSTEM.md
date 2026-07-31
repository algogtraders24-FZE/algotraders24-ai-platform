# Algotraders24 AI — Design System (D1.0)

The single source of truth for how the platform looks and behaves. Everything
here is **token-driven**: components reference semantic names, never raw hex.
The homepage is the visual reference; the dashboard, auth, billing, knowledge,
and admin surfaces are being brought onto the same language.

---

## 1. Design principles

1. **One product, one language.** A user should never be able to tell that the
   homepage, dashboard, and admin were built at different times. No module gets
   its own palette, button, or card.
2. **Tokens, not hex.** Colors, radii, shadows, and fonts live in
   `app/globals.css` as CSS custom properties surfaced to Tailwind via
   `@theme inline`. A component that hard-codes `#0C1324` or `bg-indigo-600` is
   a bug.
3. **Gold is the one accent.** `--gold` is the single primary brand color
   (primary buttons, active nav, focus rings, links-as-CTA). Blues/indigos/
   emeralds from earlier modules were incidental, not brand.
4. **Honest color.** Success/warning/danger are reserved for real state. A
   market-direction badge and a form-error alert share the same physical colors
   (via aliases) so they can never disagree.
5. **Dark, premium, calm.** Soft diffuse shadows, quiet borders, restrained
   motion. No harsh light-mode shadows, no gratuitous animation.
6. **Accessible by default.** Every interactive primitive ships with focus,
   hover, active, and disabled states and correct semantics; motion respects
   `prefers-reduced-motion` globally.

---

## 2. Color

Defined in `app/globals.css`. Dark-committed for this phase (a real light theme
requires every section migrated together).

### Surfaces (ink scale)
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#0a0e15` | Page background |
| `--ink-2` | `#131a25` | Cards, panels, inputs |
| `--ink-3` | `#1b2330` | Raised/hover fills, skeletons, chips |
| `--ink-4` | `#232b38` | Deepest fill (active states) |

### Text
| Token | Hex | Use |
|---|---|---|
| `--text` | `#eceff3` | Primary text, headings |
| `--text-2` | `#9aa3b2` | Secondary/body text |
| `--text-3` | `#8894a3` | Muted labels, captions (WCAG-AA verified ≥4.5:1 on ink and ink-2) |

### Brand & state
| Token | Hex | Use |
|---|---|---|
| `--gold` / `--gold-strong` | `#c99a44` / `#e0b564` | Primary accent, links, focus |
| `--border` | `#232b38` | All borders |
| `--signal-up` / `--success` | `#3fb27f` | Positive / success |
| `--warn` / `--warning` | `#d89552` | Caution |
| `--signal-down` / `--danger` | `#d1594a` | Negative / error |
| `--steel` / `--info` | `#8fa9c2` | Informational |

`--success`/`--warning`/`--danger`/`--info` are **aliases** of the signal
colors — same value, UI-state-appropriate name. Tailwind classes:
`bg-ink-2`, `text-text-2`, `border-border`, `text-gold`, `text-success`, etc.

---

## 3. Typography

Fonts loaded via `next/font` in `app/layout.tsx`:
- `--font-sans` (Geist) — all UI text.
- `--font-mono` (Geist Mono) — IDs, timestamps, code, metrics.
- `--font-display` (Source Serif 4) — reserved for large marketing headlines only.

**Scale** (Tailwind defaults): `text-xs` 12 · `text-sm` 14 (body default) ·
`text-base` 16 · `text-lg` 18 · `text-xl` 20 · `text-2xl` 24 (page H1) ·
`text-3xl`+ marketing. Weights: 400 body, 500 medium, 600 semibold, 700 headings.

---

## 4. Spacing, radius, shadow, layout

- **Spacing**: Tailwind 4px scale. Card padding `p-6` (md), compact `p-4`.
  Section rhythm `space-y-6`/`space-y-8`. Grid gaps `gap-4`/`gap-6`.
- **Radius**: `--radius-control` 6px (buttons, inputs, chips) ·
  `--radius-card` 12px (cards) · `--radius-panel` 20px (modals, hero panels).
  Classes: `rounded-control`, `rounded-card`, `rounded-panel`.
- **Shadow**: `shadow-raised` (cards) · `shadow-floating` (dropdowns, toasts) ·
  `shadow-overlay` (modals). Dark-tuned, soft.
- **Containers**: dashboard content `max-w-6xl`, billing `max-w-7xl`, auth
  `max-w-md`. Page gutter `p-6`.

---

## 5. Components (`components/ui/`)

All token-driven, all with proper interaction + a11y states.

| Component | Purpose | Key props |
|---|---|---|
| `Button` | Every in-page action CTA | `variant` primary/secondary/ghost/danger, `size`, `loading`, `fullWidth` |
| `ButtonLink` | Navigation CTA styled as a button (real `<a>`) | same variants (shares `buttonClasses`) |
| `Input` / `Textarea` / `Select` | Form controls | `invalid` |
| `Card` | The one surface | `padding`, `raised` |
| `Badge` | Status pill | `tone` neutral/success/warning/danger/info/gold |
| `Alert` | Banner / page-level message | `tone`, `title` |
| `Table` (+ `Thead`/`Th`/`Tbody`/`Tr`/`Td`) | Data tables | — |
| `Tabs` | In-page tab strip (arrow-key nav) | `items`, `value`, `onChange` |
| `EmptyState` | Meaningful empty screen | `title`, `description`, `action` |
| `Skeleton` | Loading placeholder | `className` |
| `Spinner` | Inline loading indicator | `size` |
| `Modal` | Dialog shell (role=dialog, Esc/backdrop close) | `open`, `onClose`, `title` |
| `Dropdown` | Menu (role=menu, outside-click/Esc close) | `trigger`, `items` |
| `Tooltip` | Hover/focus hint for any element | `label` |
| `InfoTooltip` | Click-to-reveal “(i)” product guidance (touch-friendly) | `label`, `text` |
| `Toast` (`ToastProvider` + `useToast`) | Transient confirmation (aria-live) | `push(message, tone)` |

**Rule: replace, never patch.** New UI composes these; it does not re-implement
a button or card inline.

---

## 6. Interaction & motion

- **States**: every control defines hover, `active:`, `disabled:`
  (`opacity-50` + `cursor-not-allowed`), and inherits the global
  `:focus-visible` gold ring (`app/globals.css`).
- **Keyboard**: `Tabs` supports arrow keys; `Modal`/`Dropdown`/`InfoTooltip`
  close on `Escape`; `Dropdown` uses `role=menu`; native `Select` for full
  keyboard support.
- **Motion**: transitions are short (`transition`, ~150ms). All non-essential
  motion is disabled at once under `@media (prefers-reduced-motion: reduce)`.
- **Toasts** announce via `aria-live="polite"` and never steal focus.

---

## 7. Accessibility

- Text tokens meet WCAG AA (≥4.5:1) on their intended surfaces; `--text-3`
  was specifically tuned for this in H1.6 and is unchanged.
- Semantic HTML: real `<table>`, `<nav>`, `<button>` vs `<a>` (CTAs that
  navigate use `ButtonLink`/`Link`, never a `<button>` wrapping a link).
- ARIA on composite widgets: `role=dialog`/`aria-modal` (Modal),
  `role=menu`/`aria-haspopup` (Dropdown), `role=tablist`/`aria-selected`
  (Tabs), `role=tooltip`, `aria-busy` (Button loading), `aria-invalid`
  (invalid inputs), `aria-current` (active nav).
- Skip-to-content link and global focus ring predate and are preserved by D1.0.

---

## 8. Adoption status

**100% token-migrated (D1.0 + D1.1).** Every page and component in the app and
dashboard ecosystem now references design tokens only — **zero** raw Tailwind
color utilities (`slate-*`/`gray-*`/`indigo-*`/`emerald-*`/etc.), **zero** hex
color classes (`bg-[#…]`), and **zero** `bg-white/*` glass surfaces remain in
any live `className`. This is enforceable by grep:

```bash
grep -rnE "className=\"[^\"]*(bg|text|border)-(slate|gray|neutral|indigo|sky|blue|violet|purple|emerald|green|amber|red)-[0-9]" app components sections
# → no results
```

Covered: design tokens + all 16 primitives; root layout (ToastProvider);
dashboard chrome; all auth pages; the full billing module; the full knowledge
module (incl. Details, Collections, History, Sources); all admin pages
(overview, users, subscriptions, knowledge, analytics, health, audit-logs,
beta, feedback); the AI Assistant (`components/ai/**`); Market Intelligence;
and every mock-data module — Signals, News, Publishing, Trading Copilot,
Automation, Agents — plus the public Products storefront, License, and Payment
components. Status-color maps in `config/knowledge.config.ts` and
`config/agent.config.ts` are now token-based too (success/info/warning/danger/
neutral).

**Deliberately kept as data (not chrome):** `config/billing.config.ts`
`PLAN_COLORS`/`PLAN_ACCENTS` — distinct per-tier brand hex values applied via
inline `style`, so each plan tier stays visually distinguishable (documented
since D1.0). These are values in a data map, not `className` utilities.

**Migration method (D1.1):** the bulk conversion was applied via an ordered,
shade-aware substitution (neutral surfaces → `ink`/`ink-2`/`ink-3`; borders →
`border`; text → `text`/`text-2`/`text-3`; accents → `gold`/`success`/
`warning`/`danger`, opacity suffixes preserved), followed by targeted fixups
for solid-accent-button contrast (`bg-gold` → `text-ink`) and no-op hovers
(`hover:text-gold` → `hover:text-gold-strong`). Verified with `tsc`, `lint`
(0 errors), and a passing production build.
