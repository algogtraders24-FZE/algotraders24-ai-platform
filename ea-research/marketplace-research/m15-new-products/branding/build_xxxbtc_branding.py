"""Generates the XXX BTC listing artwork: xxxbtc-icon.svg (512x512) and xxxbtc-banner.svg (1600x500).
No performance numbers are drawn into the artwork (the marketplace shows AT24-computed evidence separately).
Usage: python build_xxxbtc_branding.py"""
import os, math

HERE = os.path.dirname(os.path.abspath(__file__))

DEFS = '''
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0d0905"/><stop offset="55%" stop-color="#1a1208"/><stop offset="100%" stop-color="#241709"/></linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#fff3d1"/><stop offset="45%" stop-color="#e9c96d"/><stop offset="100%" stop-color="#b8860b"/></linearGradient>
    <linearGradient id="blue" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffd29a"/><stop offset="100%" stop-color="#f7931a"/></linearGradient>
    <linearGradient id="sky" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#6b3d0f" stop-opacity="0.9"/><stop offset="100%" stop-color="#1a1208" stop-opacity="0.95"/></linearGradient>
    <radialGradient id="halo" cx="50%" cy="35%" r="60%"><stop offset="0%" stop-color="#f7931a" stop-opacity="0.35"/><stop offset="100%" stop-color="#f7931a" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/></pattern>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>'''


def skyline(x0, y0, w, h, seed=3):
    """Volume-bar texture along the bottom instead of a city skyline."""
    out = []
    n = 40
    bw = w / n
    for i in range(n):
        bh = h * (0.18 + 0.55 * abs(math.sin(i * 0.7 + seed)) * (0.5 + 0.5 * (i / n)))
        out.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="url(#sky)" fill-opacity="0.8"/>' % (x0 + i * bw, y0 + h - bh, bw - 3, bh))
    return "\n  ".join(out)


def candles(x0, y0, scale=1.0):
    """Breakout chart: 9 candles, the last 3 break above a dashed resistance level. Returns (svg, resistance_y)."""
    data = [(0, 60, 22, 'dn'), (1, 52, 26, 'up'), (2, 58, 20, 'dn'), (3, 46, 28, 'up'), (4, 50, 18, 'dn'), (5, 40, 30, 'up'),
            (6, 22, 34, 'up'), (7, 6, 36, 'up'), (8, -14, 40, 'up')]
    out = []
    step = 34 * scale
    for i, top, h, kind in data:
        col = "#3fd29a" if kind == 'up' else "#ff5d5d"
        x = x0 + i * step
        out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="%.1f"/>' % (x, y0 + (top - 10) * scale, x, y0 + (top + h + 10) * scale, col, 2.4 * scale))
        out.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="2" fill="%s"/>' % (x - 8 * scale, y0 + top * scale, 16 * scale, h * scale, col))
    res_y = y0 + 38 * scale
    out.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#e9c96d" stroke-width="%.1f" stroke-dasharray="%.0f 8" stroke-linecap="round"/>' % (x0 - 16 * scale, res_y, x0 + 8 * step + 22 * scale, res_y, 2.6 * scale, 10 * scale))
    # five module nodes along the breakout path
    pts = [(5, 30), (6, 12), (7, -4), (8, -22)]
    return "\n  ".join(out), res_y


def modules_nodes(x0, y0, scale, cx_list):
    out = []
    for i, (cx, cy) in enumerate(cx_list):
        out.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#1a1208" stroke="url(#gold)" stroke-width="%.1f"/>' % (cx, cy, 9 * scale, 2.2 * scale))
        out.append('<text x="%.1f" y="%.1f" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="%.0f" font-weight="800" fill="#f3d27a">%d</text>' % (cx, cy + 3.6 * scale, 10 * scale, i + 1))
    return "\n  ".join(out)


def icon():
    ch, res_y = candles(88, 118, 1.15)
    return f'''<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">{DEFS}
  <clipPath id="clip"><rect x="6" y="6" width="500" height="500" rx="80"/></clipPath>
  <rect x="6" y="6" width="500" height="500" rx="80" fill="url(#bg)"/>
  <g clip-path="url(#clip)">
    <rect width="512" height="512" fill="url(#grid)"/>
    <ellipse cx="256" cy="150" rx="260" ry="190" fill="url(#halo)"/>
    {skyline(6, 250, 500, 150)}
  </g>
  <rect x="6" y="6" width="500" height="500" rx="80" fill="none" stroke="url(#gold)" stroke-width="7"/>
  <rect x="19" y="19" width="474" height="474" rx="68" fill="none" stroke="#d4af37" stroke-opacity="0.35" stroke-width="1.2"/>
  <g filter="url(#glow)">
  {ch}
  </g>
  <text x="256" y="68" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800" letter-spacing="14" fill="#f3d27a">XXX</text>
  <text x="256" y="372" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="108" font-weight="900" fill="url(#gold)" letter-spacing="2">BTC</text>
  <g transform="translate(256 392)"><line x1="-130" y1="0" x2="-14" y2="0" stroke="#d4af37" stroke-opacity="0.6"/><line x1="14" y1="0" x2="130" y2="0" stroke="#d4af37" stroke-opacity="0.6"/><rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" fill="url(#gold)"/></g>
  <text x="256" y="424" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" letter-spacing="3" fill="#ffe9cf">24/7 BREAKOUT</text>
  <rect x="150" y="438" width="212" height="30" rx="15" fill="#1a1208" stroke="url(#blue)" stroke-width="1.6"/>
  <text x="256" y="458" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="800" letter-spacing="2.5" fill="#ffd29a">OPTIONAL AI FILTER</text>
</svg>
'''


def banner():
    ch, res_y = candles(980, 150, 2.0)
    chips = ["5 BREAKOUT MODULES", "OPTIONAL AI FILTER", "MOON-LOCK EXIT", "SPREAD SHIELD"]
    x = 80
    parts = []
    for t in chips:
        w = int(12.4 * len(t) + 48)
        parts.append('<rect x="%d" y="372" width="%d" height="40" rx="20" fill="#1a1208" stroke="url(#blue)" stroke-width="1.8"/><text x="%d" y="398" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" letter-spacing="2" fill="#ffd29a">%s</text>' % (x, w, x + w // 2, t))
        x += w + 16
    chip_svg = "\n  ".join(parts)
    return f'''<svg viewBox="0 0 1600 500" xmlns="http://www.w3.org/2000/svg">{DEFS}
  <clipPath id="clipb"><rect x="0" y="0" width="1600" height="500"/></clipPath>
  <rect width="1600" height="500" fill="url(#bg)"/>
  <g clip-path="url(#clipb)">
    <rect width="1600" height="500" fill="url(#grid)"/>
    <ellipse cx="1220" cy="190" rx="560" ry="330" fill="url(#halo)"/>
    {skyline(700, 300, 900, 200, 5)}
  </g>
  <rect x="3" y="3" width="1594" height="494" fill="none" stroke="url(#gold)" stroke-width="5"/>
  <g filter="url(#glow)">
  {ch}
  </g>
  <text x="80" y="104" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="800" letter-spacing="18" fill="#f3d27a">ALGOTRADERS24</text>
  <text x="76" y="250" font-family="Arial, Helvetica, sans-serif" font-size="150" font-weight="900" fill="url(#gold)" letter-spacing="2">XXX BTC</text>
  <text x="80" y="312" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="700" fill="#ffe9cf">Multi-module 24/7 breakout EA for Bitcoin (BTCUSD), M15</text>
  <text x="80" y="348" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="600" letter-spacing="1" fill="#c4a27a">MT5  ·  pending-order breakouts  ·  optional H1 trend filter  ·  on-chart dashboard</text>
  {chip_svg}
  <text x="80" y="452" font-family="Arial, Helvetica, sans-serif" font-size="15" font-weight="600" letter-spacing="2" fill="#9c8062">PAST PERFORMANCE IS NOT A GUARANTEE OF FUTURE RESULTS  ·  EVIDENCE SHOWN BY THE MARKETPLACE, NOT BY THIS IMAGE</text>
</svg>
'''


if __name__ == "__main__":
    open(os.path.join(HERE, "xxxbtc-icon.svg"), "w", encoding="utf-8").write(icon())
    open(os.path.join(HERE, "xxxbtc-banner.svg"), "w", encoding="utf-8").write(banner())
    print("ok")
