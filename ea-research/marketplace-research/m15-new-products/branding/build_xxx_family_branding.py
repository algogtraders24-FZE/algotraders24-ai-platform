"""Generates the three XXX product logos with a DIFFERENT emblem each (same frame family, own palette + own mark):
  XXX US30  - columned exchange building on navy/steel-blue
  XXX BTC   - coin with a B and blockchain nodes on deep orange/brown
  XXX GOLD  - stacked gold bars with a sparkle on black/gold
Writes xxxus30-/xxxbtc-/xxxgold-icon.svg (512x512) and -banner.svg (1600x500).
No performance numbers are drawn into the artwork (the marketplace shows AT24-computed evidence separately).
Usage: python build_xxx_family_branding.py"""
import os, math

HERE = os.path.dirname(os.path.abspath(__file__))

THEMES = {
    "us30": dict(bg1="#040a18", bg2="#0a1a3a", bg3="#12233f", hi="#e8f2ff", mid="#7db8ff", dk="#2b6fe0", glow="#3b82f6",
                 txt="#cfe3ff", sub="#8da2bd", fine="#6f84a3", name="US30", sub1="DOW JONES  ·  M15", chips=["5 BREAKOUT MODULES", "H1 TREND FILTER", "MOON-LOCK EXIT", "PROP-FIRM SHIELDS"],
                 tag="Multi-module breakout EA for the Dow Jones (US30), M15", tag2="MT5  ·  pending-order breakouts  ·  optional AI filter  ·  on-chart dashboard"),
    "btc": dict(bg1="#0d0702", bg2="#241204", bg3="#33190a", hi="#ffe9cf", mid="#ffb257", dk="#e8780a", glow="#f7931a",
                txt="#ffe9cf", sub="#c4a27a", fine="#9c8062", name="BTC", sub1="24/7  ·  BITCOIN  ·  M15", chips=["5 BREAKOUT MODULES", "24/7 CRYPTO MODE", "MOON-LOCK EXIT", "SPREAD SHIELD"],
                tag="Multi-module 24/7 breakout EA for Bitcoin (BTCUSD), M15", tag2="MT5  ·  pending-order breakouts  ·  optional AI filter  ·  on-chart dashboard"),
    "gold": dict(bg1="#080604", bg2="#17110a", bg3="#241a0b", hi="#fff3d1", mid="#e9c96d", dk="#b8860b", glow="#d4af37",
                 txt="#fff3d1", sub="#b9a77d", fine="#8d7d58", name="GOLD", sub1="XAUUSD  ·  M15", chips=["5 BREAKOUT MODULES", "TIME-STOP + BREAKEVEN", "MOON-LOCK EXIT", "PROP-FIRM SHIELDS"],
                 tag="Multi-module breakout EA for Gold (XAUUSD), M15", tag2="MT5  ·  pending-order breakouts  ·  H1 trend filter  ·  on-chart dashboard"),
}


def defs(t):
    return f'''
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="{t['bg1']}"/><stop offset="55%" stop-color="{t['bg2']}"/><stop offset="100%" stop-color="{t['bg3']}"/></linearGradient>
    <linearGradient id="brand" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="{t['hi']}"/><stop offset="45%" stop-color="{t['mid']}"/><stop offset="100%" stop-color="{t['dk']}"/></linearGradient>
    <linearGradient id="face" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="{t['hi']}"/><stop offset="55%" stop-color="{t['mid']}"/><stop offset="100%" stop-color="{t['dk']}"/></linearGradient>
    <linearGradient id="side" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="{t['dk']}"/><stop offset="100%" stop-color="{t['mid']}" stop-opacity="0.6"/></linearGradient>
    <radialGradient id="halo" cx="50%" cy="38%" r="55%"><stop offset="0%" stop-color="{t['glow']}" stop-opacity="0.38"/><stop offset="100%" stop-color="{t['glow']}" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/></pattern>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>'''


# ------------------------------------------------------------------ emblems (drawn around (0,0), ~240 wide x 220 tall)
def emblem_us30(t):
    """Columned exchange building: pediment, 6 columns, base steps, stars, breakout arrow."""
    cols = "".join('<rect x="%d" y="-26" width="16" height="92" rx="3" fill="url(#face)"/><rect x="%d" y="-30" width="22" height="8" rx="2" fill="{m}"/><rect x="%d" y="62" width="22" height="8" rx="2" fill="{m}"/>'.replace("{m}", t["mid"]) % (x, x - 3, x - 3) for x in (-96, -62, -28, 12, 46, 80))
    stars = "".join('<path d="M%d -118 l4 10 11 1 -8 7 3 11 -10 -6 -10 6 3 -11 -8 -7 11 -1z" fill="%s"/>' % (x, t["hi"]) for x in (-44, 0, 44))
    return f'''
    {stars}
    <path d="M-124 -34 L0 -92 L124 -34 Z" fill="url(#face)"/>
    <path d="M-100 -40 L0 -84 L100 -40" fill="none" stroke="{t['bg2']}" stroke-width="3" opacity="0.55"/>
    <circle cx="0" cy="-58" r="9" fill="{t['bg2']}" stroke="{t['hi']}" stroke-width="2.5"/>
    {cols}
    <rect x="-118" y="70" width="236" height="12" rx="3" fill="url(#face)"/>
    <rect x="-132" y="82" width="264" height="12" rx="3" fill="{t['mid']}"/>
    <rect x="-146" y="94" width="292" height="12" rx="3" fill="{t['dk']}"/>
    <polyline points="-150,40 -92,10 -50,26 10,-30 70,-6 150,-86" fill="none" stroke="{t['hi']}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow)"/>
    <path d="M132 -98 L158 -92 L150 -68 Z" fill="{t['hi']}" filter="url(#glow)"/>'''


def emblem_btc(t):
    """Coin with a B, orbit ring and blockchain nodes."""
    nodes = []
    for i in range(8):
        a = math.radians(i * 45 + 22.5)
        x, y = 112 * math.cos(a), 112 * math.sin(a)
        nodes.append('<circle cx="%.1f" cy="%.1f" r="9" fill="%s" stroke="%s" stroke-width="3"/>' % (x, y, t["bg2"], t["mid"]))
        a2 = math.radians((i + 1) * 45 + 22.5)
        x2, y2 = 112 * math.cos(a2), 112 * math.sin(a2)
        nodes.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2.5" stroke-opacity="0.55"/>' % (x, y, x2, y2, t["mid"]))
    return f'''
    {"".join(nodes)}
    <circle cx="0" cy="0" r="92" fill="url(#face)" filter="url(#glow)"/>
    <circle cx="0" cy="0" r="80" fill="none" stroke="{t['bg2']}" stroke-width="5" opacity="0.5"/>
    <circle cx="0" cy="0" r="86" fill="none" stroke="{t['hi']}" stroke-width="2" opacity="0.7"/>
    <g fill="{t['bg2']}">
      <rect x="-14" y="-62" width="10" height="20" rx="2"/><rect x="8" y="-62" width="10" height="20" rx="2"/>
      <rect x="-14" y="42" width="10" height="20" rx="2"/><rect x="8" y="42" width="10" height="20" rx="2"/>
    </g>
    <text x="-3" y="38" text-anchor="middle" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="118" font-weight="900" fill="{t['bg2']}">B</text>'''


def emblem_gold(t):
    """Stack of gold bars (3D trapezoids) with a sparkle."""
    def bar(cx, cy, w, h, k=0):
        sk = h * 0.55
        top = f'<path d="M{cx - w/2 + sk:.0f} {cy - h:.0f} L{cx + w/2 - sk:.0f} {cy - h:.0f} L{cx + w/2:.0f} {cy:.0f} L{cx - w/2:.0f} {cy:.0f} Z" fill="url(#face)"/>'
        edge = f'<path d="M{cx - w/2:.0f} {cy:.0f} L{cx + w/2:.0f} {cy:.0f} L{cx + w/2:.0f} {cy + 14:.0f} L{cx - w/2:.0f} {cy + 14:.0f} Z" fill="url(#side)"/>'
        shine = f'<path d="M{cx - w/2 + sk + 10:.0f} {cy - h + 7:.0f} L{cx + w/4:.0f} {cy - h + 7:.0f}" stroke="{t["hi"]}" stroke-width="4" stroke-linecap="round" opacity="0.8"/>'
        return top + edge + shine
    spark = f'<path d="M0 -150 L9 -118 L40 -110 L9 -102 L0 -70 L-9 -102 L-40 -110 L-9 -118 Z" fill="{t["hi"]}" filter="url(#glow)"/>'
    return f'''
    {bar(-62, 96, 150, 46)}{bar(66, 96, 150, 46)}
    {bar(0, 36, 150, 46)}
    {bar(-62 + 62, -22, 150, 46)}
    {spark}
    <circle cx="86" cy="-40" r="4" fill="{t['hi']}" filter="url(#glow)"/><circle cx="-94" cy="-66" r="3" fill="{t['hi']}" filter="url(#glow)"/>'''


EMBLEMS = {"us30": emblem_us30, "btc": emblem_btc, "gold": emblem_gold}


def icon(key):
    t = THEMES[key]
    em = EMBLEMS[key](t)
    return f'''<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">{defs(t)}
  <clipPath id="clip"><rect x="6" y="6" width="500" height="500" rx="80"/></clipPath>
  <rect x="6" y="6" width="500" height="500" rx="80" fill="url(#bg)"/>
  <g clip-path="url(#clip)"><rect width="512" height="512" fill="url(#grid)"/><ellipse cx="256" cy="170" rx="270" ry="210" fill="url(#halo)"/></g>
  <rect x="6" y="6" width="500" height="500" rx="80" fill="none" stroke="url(#brand)" stroke-width="7"/>
  <rect x="19" y="19" width="474" height="474" rx="68" fill="none" stroke="{t['mid']}" stroke-opacity="0.35" stroke-width="1.2"/>
  <text x="256" y="62" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" letter-spacing="14" fill="{t['hi']}">XXX</text>
  <g transform="translate(256 192) scale(0.92)">{em}</g>
  <text x="256" y="388" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="{ 116 if key != 'gold' else 108 }" font-weight="900" fill="url(#brand)" letter-spacing="2">{t['name']}</text>
  <g transform="translate(256 406)"><line x1="-130" y1="0" x2="-14" y2="0" stroke="{t['mid']}" stroke-opacity="0.6"/><line x1="14" y1="0" x2="130" y2="0" stroke="{t['mid']}" stroke-opacity="0.6"/><rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" fill="url(#brand)"/></g>
  <text x="256" y="440" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="700" letter-spacing="3" fill="{t['txt']}">5-MODULE BREAKOUT</text>
  <text x="256" y="466" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" letter-spacing="3" fill="{t['sub']}">{t['sub1']}</text>
</svg>
'''


def banner(key):
    t = THEMES[key]
    em = EMBLEMS[key](t)
    x = 80
    parts = []
    for c in t["chips"]:
        w = int(12.4 * len(c) + 48)
        parts.append('<rect x="%d" y="372" width="%d" height="40" rx="20" fill="%s" stroke="%s" stroke-width="1.8"/><text x="%d" y="398" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" letter-spacing="2" fill="%s">%s</text>' % (x, w, t["bg2"], t["mid"], x + w // 2, t["hi"], c))
        x += w + 16
    chips = "\n  ".join(parts)
    return f'''<svg viewBox="0 0 1600 500" xmlns="http://www.w3.org/2000/svg">{defs(t)}
  <rect width="1600" height="500" fill="url(#bg)"/>
  <rect width="1600" height="500" fill="url(#grid)"/>
  <ellipse cx="1230" cy="230" rx="560" ry="360" fill="url(#halo)"/>
  <rect x="3" y="3" width="1594" height="494" fill="none" stroke="url(#brand)" stroke-width="5"/>
  <g transform="translate(1270 232) scale(1.18)">{em}</g>
  <text x="80" y="104" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="800" letter-spacing="18" fill="{t['hi']}">ALGOTRADERS24</text>
  <text x="76" y="250" font-family="Arial, Helvetica, sans-serif" font-size="150" font-weight="900" fill="url(#brand)" letter-spacing="2">XXX {t['name']}</text>
  <text x="80" y="312" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="700" fill="{t['txt']}">{t['tag']}</text>
  <text x="80" y="348" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="600" letter-spacing="1" fill="{t['sub']}">{t['tag2']}</text>
  {chips}
  <text x="80" y="452" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="600" letter-spacing="2" fill="{t['fine']}">PAST PERFORMANCE IS NOT A GUARANTEE OF FUTURE RESULTS  ·  EVIDENCE SHOWN BY THE MARKETPLACE, NOT BY THIS IMAGE</text>
</svg>
'''


if __name__ == "__main__":
    for key in THEMES:
        open(os.path.join(HERE, "xxx%s-icon.svg" % key), "w", encoding="utf-8").write(icon(key))
        open(os.path.join(HERE, "xxx%s-banner.svg" % key), "w", encoding="utf-8").write(banner(key))
    print("ok")
