# IA1 — Backoffice Information Architecture & Navigation Refactor

Sprint scope: restructure the `/dashboard/*` backoffice sidebar around the
locked AT24 IA. Navigation/structure only — no visual redesign beyond what
grouping requires, no engine changes, no pricing/credit-policy decisions.

## A. IA implementation

The old nav (`DASHBOARD_NAV`, `frontend/config/dashboard.config.ts`) was a
single flat list of 17 items with no grouping and no visible product
boundaries. It's replaced by `DASHBOARD_NAV_GROUPS`: an ungrouped
`Dashboard` link, five named groups (`PRODUCTS` / `INTELLIGENCE` /
`AUTOMATION` / `WORKSPACE` / `ACCOUNT`) matching the locked hierarchy, and
a final ungrouped `Admin` entry (admin-only, unchanged, deliberately kept
outside the customer-facing lock). Items may carry `children` — a second,
unlabeled nesting tier used only for real existing pages that don't have
their own slot in the locked hierarchy (e.g. Quant Lite/Pro under Quant,
Trading Copilot/Knowledge Base under AI Assistant) rather than a distinct
top-level entry. `DashboardSidebar.tsx` and `MobileNav.tsx` (desktop
sidebar and the `<md` slide-in drawer) both render the same
`DASHBOARD_NAV_GROUPS` — one data source, two presentations, same pattern
the prior sprint (D2.3 Phase 3) established for the flat list.

Why grouped + nested rather than a flatter alternative: the locked IA
names exactly 5 groups with a fixed item count each; several real existing
pages (Trading Copilot, Knowledge Base, Publishing, Billing, My Products)
have no slot in that fixed set. Deleting them was ruled out (an
acceptance criterion: "Existing working functionality is preserved").
Adding a 6th top-level group was ruled out ("do not redesign or
reinterpret the top-level structure without explicit approval"). Nesting
under the closest conceptually-related locked item was the only option
left that satisfies both constraints.

## B. Route mapping

| Old item | New IA location | Route | Action |
|---|---|---|---|
| Dashboard | Dashboard (top) | `/dashboard` | relocate (unchanged) |
| Workspace | *(implicit — Algo Testing Pro + AI Research both point into it)* | `/dashboard/workspace` | relocate, see below |
| Licenses | ACCOUNT / Licenses | `/dashboard/licenses` | relocate |
| My Purchases | ACCOUNT / Purchases | `/dashboard/purchases` | relocate, relabeled to match locked wording |
| My Products | PRODUCTS / Marketplace (nested) | `/marketplace/my-products` | relocate (nested) |
| AI Signals | INTELLIGENCE / AI Signals | `/dashboard/signals` | relocate |
| Market Intel | INTELLIGENCE / Market Intelligence | `/dashboard/market-intelligence` | relocate, relabeled |
| AI News | INTELLIGENCE / AI News | `/dashboard/news` | relocate |
| AI Assistant | INTELLIGENCE / AI Assistant | `/dashboard/assistant` | relocate |
| Trading Copilot | INTELLIGENCE / AI Assistant (nested) | `/dashboard/trading-copilot` | relocate (nested — see D below) |
| Publishing | AUTOMATION / Automations (nested) | `/dashboard/publishing` | relocate (nested — see judgment call below) |
| Automation | AUTOMATION / Automations | `/dashboard/automation` | relocate |
| AI Agents | INTELLIGENCE / AI Agents | `/dashboard/agents` | relocate |
| Knowledge Base | INTELLIGENCE / AI Assistant (nested) | `/dashboard/knowledge` | relocate (nested) |
| Orders | *(no nav slot)* | `/dashboard/orders` | **deprecated from nav** — see G |
| Billing | ACCOUNT / Settings (nested) | `/dashboard/billing` | relocate (nested) |
| Admin | Admin (bottom, admin-only) | `/dashboard/admin` | relocate (unchanged) |
| *(new)* | PRODUCTS / Quant / Quant Lite | `/quant-lite` | added — existed, had no backoffice nav entry |
| *(new)* | PRODUCTS / Quant / Quant Pro | `/quant-lite/upgrade` | added — existing honest "not yet available" page |
| *(new)* | PRODUCTS / Algo Testing Pro | `/dashboard/workspace` | added — real P3.x integration, toolbar/panel only, no dedicated page |
| *(new)* | PRODUCTS / Marketplace | `/marketplace` | added — existed, had no backoffice nav entry |
| *(new)* | INTELLIGENCE / AI Research | `/dashboard/workspace#research` | added — real Research section inside Workspace, no separate page (fixed a non-functional anchor along the way, see D) |
| *(new)* | WORKSPACE / Strategies | `/quant-lite/builder` | added |
| *(new)* | WORKSPACE / Backtests | `/quant-lite/backtest` | added |
| *(new)* | WORKSPACE / Results | `/quant-lite/library` | added |
| *(new)* | ACCOUNT / Credits | `/dashboard/credits` | added — new honest "not yet available" page |
| *(new)* | ACCOUNT / Settings | `/dashboard/settings` | added — new real account page |

No route paths changed. Nothing was moved on disk or renamed — every
change is additive (new nav entries, new pages) or a relabel/regroup of an
existing sidebar entry. No redirects are required.

## C. Product boundaries — confirmed

- **Quant Lite ≠ Quant Pro**: still two separate systems. Quant Lite is
  the existing `app/quant-lite/**` / `services/quant-lite/**` /
  `quant-engine/**` tree. "Quant Pro" has no built engine or page — its
  nav entry links to the pre-existing `/quant-lite/upgrade` comparison
  page, which already states "Quant Pro is a separate, advanced product
  ... Not yet available." Nothing was merged, and no Quant Pro
  implementation was started this sprint.
- **Algo Testing Pro ≠ Quant**: it's a sibling top-level PRODUCTS item,
  not nested under Quant. It's the P3.x `at24-quant-engine` integration
  wired into the Native Chart workspace — a fully separate engine from
  both Quant Lite and Quant Pro, untouched this sprint.

## D. Intelligence consolidation

Moved under `INTELLIGENCE`: AI Assistant, AI Signals, Market Intelligence
(relabeled from "Market Intel"), AI News, AI Agents — all pre-existing
top-level nav items, now grouped. AI Research is new (see B) — it points
at the real per-symbol Research section already living inside the
Workspace page (`components/workspace/WorkspaceResearch.tsx`, wrapped in
a `WorkspaceSection id="research"`) rather than a duplicate second page,
since a prior sprint (D2.4.A1) already established that a standalone
"Research" surface would be thin duplicate content over Assistant on the
marketing site. **Found and fixed in passing**: `WorkspaceSection`'s `id`
prop was only used as a persisted-collapse key — it was never rendered as
an actual DOM `id`, so `/dashboard/workspace#research` would not have
scrolled anywhere. Added `id={id}` to the rendered `<section>`
(`components/workspace/WorkspaceSection.tsx`) — safe, because each of the
three `PanelId`s (`chart` / `assistant` / `research`) renders exactly
once in the workspace page, confirmed by search before making the change.

Copilot: no separate "AI Copilot" nav item was created. The pre-existing
`Trading Copilot` page (a real, distinct product surface, not the
sprint's "contextual Copilot" concept) is nested under AI Assistant
rather than promoted to its own Intelligence slot, per the explicit
instruction against duplicating Copilot in the nav.

## E. Automation

`AUTOMATION` stays a fully separate top-level group from `INTELLIGENCE`,
holding `Automations` (`/dashboard/automation`, unchanged). Nothing from
Intelligence was moved here and nothing from here was moved into
Intelligence.

**Judgment call — Publishing**: nested under Automations rather than
given a slot elsewhere. It doesn't fit Products, Intelligence-for-the-
user, or Account, and its actual content (AI draft generation plus a
publishing queue/schedule/content calendar) is scheduled/orchestrated
action — the automation boundary as the sprint doc itself defines it. If
this call is wrong, it's a one-line move in
`frontend/config/dashboard.config.ts`.

## F. Credits

Location: `ACCOUNT / Credits` → `/dashboard/credits` (new page).
Implementation status: **not implemented**. There is no credit ledger, no
per-action metering, and no pricing — all explicitly out of scope for
this sprint per the brief itself. The page states this directly instead
of fabricating a balance or usage number, and links to `/dashboard/billing`
(the real, working plan/subscription surface) as the current mechanism
that actually gates AI feature access.

## G. Files changed

- `frontend/config/dashboard.config.ts` — nav data model rewritten (`DASHBOARD_NAV` flat list → `DASHBOARD_NAV_GROUPS` grouped/nested).
- `frontend/components/dashboard/DashboardSidebar.tsx` — renders groups + nested children.
- `frontend/components/dashboard/MobileNav.tsx` — same, for the mobile drawer.
- `frontend/components/workspace/WorkspaceSection.tsx` — `id` prop now also rendered as a real DOM id (bug fix enabling the new Research anchor link).
- `frontend/app/dashboard/settings/page.tsx` — new.
- `frontend/app/dashboard/credits/page.tsx` — new.

**Flagged, not changed**: `frontend/app/dashboard/orders/page.tsx` reads
from a static mock array (`data/orders.ts` via `services/order.service.ts`)
and is a legacy duplicate of the real, DB-backed Purchases page — the
same class of gap Sprint L2.5 removed for the old "Payments" page. It has
no nav entry in the new IA (so no dead link), but the route/page itself
was intentionally left untouched — deleting code is a functionality
change outside a navigation sprint's scope. Recommend a follow-up cleanup
sprint to remove it once confirmed it has no remaining external links.

## H. Verification

- **Route inventory**: every href above was checked against the actual
  `app/` tree before being wired in (not assumed from the old list).
- **Build / tests**: see the sprint completion message for this run's
  `npm run build` / `npm run lint` / `npm test` results.
- **No dead links**: every leaf href points at a page that exists.
  `Quant Pro` and `Credits` point at pages that exist and honestly state
  "not yet available" — that is a real page, not a broken route.
- **Known issues**: none blocking. `Algo Testing Pro` and `AI Research`
  both resolve to `/dashboard/workspace` (a real, single multi-purpose
  page hosting Research, Assistant, and the Algo Test toolbar/panel
  simultaneously) rather than each getting a dedicated page — that's the
  real current shape of that feature, not a shortcut.
- **Deferred work**: Quant Pro's actual engine/product (still not built —
  out of scope, was never in scope), real credit metering/pricing
  (explicitly out of scope this sprint), a persisted per-account
  Strategies/Backtests/Results history for Quant Lite (documented gap
  since Q1.6, pre-dates this sprint), the Orders page cleanup flagged in G.

## I. Before/after

**Before**: one flat, 17-item sidebar list with no grouping — Quant Lite,
Quant Pro, Algo Testing Pro, and Marketplace were entirely absent from
the backoffice nav (reachable only by typing the URL); AI product
capabilities, Automation, and commercial/account items were interleaved
with no visible boundary; Settings and Credits pointed nowhere (Settings
had been previously and correctly removed as a dead link).

**After**: `Dashboard`, then `PRODUCTS` (Quant [Lite/Pro] · Algo Testing
Pro · Marketplace [+ My Products]), `INTELLIGENCE` (AI Assistant [+
Trading Copilot, Knowledge Base] · AI Signals · Market Intelligence · AI
News · AI Research · AI Agents), `AUTOMATION` (Automations [+
Publishing]), `WORKSPACE` (Strategies · Backtests · Results), `ACCOUNT`
(Credits · Purchases · Licenses · Settings [+ Billing]), then Admin
(admin-only) — the locked hierarchy, fully reachable, nothing deleted.
