# Pro Chart: reference layout and feature list (recorded 2026-11-22 from the owner's Pipflow session, BTC/USD H1)

Goal (owner): the same chart system as the reference, clean, full screen, so it can be shown to clients. Everything below is what the reference chart page has. Status column is for AT24.

## Page shell
The chart page fills the whole window (no site chrome, no page scroll): left tool rail, top bar, chart, footer, right panel. Dark, seamless (rail, chart and panel share one near-black background with thin dividers).

## Left tool rail (icon only, flyouts open to the right)
| Item | Reference behaviour | AT24 |
|---|---|---|
| Collapse chevron | collapses the rail | to build |
| Magnet | snap drawing points to candle open / high / low / close | to build |
| Cursor | default tool | have |
| LINES flyout | Trendline, Ray, Horizontal Line, Vertical Line, Parallel Channel, Pitchfork | trendline + horizontal have; rest to build |
| FIBONACCI flyout | Retracement, Extension | retracement have; extension to build |
| Rectangle | box | have |
| MEASURE flyout | Measure, Fixed Range Volume Profile, Position (long / short R box) | to build |
| ANNOTATE flyout | Arrow, Text, Callout, Brush | to build |
| Zoom in / Zoom out | buttons | to build |
| Colour swatch | colour of new / selected drawing | to build |
| Line width | width of new / selected drawing | to build |
| Undo | undo last drawing action | to build |
| Lock | lock all drawings (no select / move) | to build |
| Eraser | click a drawing to remove it | to build |
| Trash | clear all drawings | have (Clear all) |

## Top bar (one row)
Menu (sidebar), symbol pill with search, M1 M5 M15 M30 H1 H4 D1 W1, chart-type dropdown (Candlestick, Bar, Line, Area, each with a one-line description), indicators / presets button; right side: Layers popup, analyses counter (x/10), live dot, more menu (Indicators, Saved setups, Indicator presets, Screenshot, chart type list).
AT24: symbol pill, timeframes (labels to match), chart type (Area missing), Layers, live, more menu have; counter, saved setups / presets to build.

## Chart
Price on the top-left (pair, timeframe, category, big price). Last-price label on the axis (green up / red down candle). Faint grid. Right-hand price axis with large labels; drag or wheel on it rescales. Annotations as dark pills. Plan as a box on the chart. Dotted full-width S/R lines, unlabelled. Right padding for the plan box.

## Footer
Range presets 1D 5D 1M 3M 6M YTD 1Y ALL and a UTC clock (have).

## Right panel (fixed height, internal scroll)
Tabs: Chat, voice assistant, Trade, Strategies; icons for slash commands and history.
- Chat: Re-analyze, save, clear; "Analysis from H1, now"; plan card (green long / red short, entry / stop / target, R:R, Execute); Annotations detected (expandable per kind with price ranges); Market Analysis paragraph; quick chips Entry / Trend / Risk; "Ask anything" box.
- Voice assistant tab: Voice / Text switch, "Start Conversation".
- Trade: broker account panel. Strategies: watching cards, build with the assistant, gallery.
AT24: analysis tab, PRAGYA tab (text), Trade, Strategies have; voice, save / clear, history, slash commands to build.

## Analyze reveal
Scan line sweeping left to right, glowing price wave, "ANALYZING nn %" and bottom progress line, spinner in the panel, "Analysis complete" toast, counter increments (have, with sound).

## Not copied on purpose
Win-rate percentages on the plan card ("66 % win-rate LIVE") and "high-probability" wording. AT24 shows the measured record, the luck baseline and the stand-aside state instead.
