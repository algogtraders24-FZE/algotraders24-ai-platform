"""Generates the four AT24 Local Trade Copier icons (512x512 SVG, dark + gold AT24 look).
Usage: python build_icons.py   -> copier-<from>-to-<to>-icon.svg (+ preview.html with all four)"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PLAT = {"MT4": ("#ffb454", "#ff8a1f"), "MT5": ("#5ec8ff", "#2b8cff")}   # light, deep


def candles(x0, y0, glow):
    """Mini candlestick chart inside a 150x70 area starting at (x0, y0)."""
    data = [(10, 40, 14, 'up'), (30, 30, 22, 'up'), (50, 46, 14, 'dn'), (70, 24, 26, 'up'), (90, 34, 16, 'dn'), (110, 16, 28, 'up')]
    out = []
    for dx, top, h, kind in data:
        col = "#3fd29a" if kind == 'up' else "#ff5d5d"
        x = x0 + dx
        out.append('<line x1="%d" y1="%d" x2="%d" y2="%d" stroke="%s" stroke-width="2"/>' % (x, y0 + top - 6, x, y0 + top + h + 6, col))
        out.append('<rect x="%d" y="%d" width="9" height="%d" rx="1.5" fill="%s"/>' % (x - 4.5, y0 + top, h, col))
    line = "%d,%d %d,%d %d,%d %d,%d %d,%d" % (x0 + 6, y0 + 62, x0 + 40, y0 + 44, x0 + 70, y0 + 52, x0 + 100, y0 + 26, x0 + 128, y0 + 6)
    out.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"%s/>'
               % (line, "#f3d27a" if glow else "#8da2bd", ' filter="url(#glow)"' if glow else ""))
    return "\n  ".join(out)


def terminal(x, y, plat, role, active):
    light, deep = PLAT[plat]
    stroke = 'url(#gold)' if active else '#4a607e'
    return f'''
  <g>
    <rect x="{x}" y="{y}" width="176" height="140" rx="16" fill="#0c1322" stroke="{stroke}" stroke-width="{3.5 if active else 3}"{' filter="url(#glow)"' if active else ''}/>
    <path d="M{x} {y+30} V{y+16} a16 16 0 0 1 16 -16 h144 a16 16 0 0 1 16 16 V{y+30} Z" fill="#18233a"/>
    <circle cx="{x+16}" cy="{y+15}" r="4.2" fill="#ff5d5d"/><circle cx="{x+30}" cy="{y+15}" r="4.2" fill="#f3c13a"/><circle cx="{x+44}" cy="{y+15}" r="4.2" fill="#3fd29a"/>
    <rect x="{x+112}" y="{y+6}" width="54" height="18" rx="9" fill="url(#p{plat})"/>
    <text x="{x+139}" y="{y+19}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="800" fill="#06101d">{plat}</text>
    <g stroke="#1b2740" stroke-width="1"><line x1="{x+12}" y1="{y+62}" x2="{x+164}" y2="{y+62}"/><line x1="{x+12}" y1="{y+88}" x2="{x+164}" y2="{y+88}"/><line x1="{x+12}" y1="{y+114}" x2="{x+164}" y2="{y+114}"/></g>
  {candles(x + 12, y + 44, active)}
  </g>
  <text x="{x+88}" y="{y+166}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" letter-spacing="3" fill="{'#f3d27a' if active else '#8da2bd'}">{role}</text>'''


# one accent theme per direction so the four cards are told apart at a glance
THEMES = {
    ("MT5", "MT5"): dict(name="blue",   light="#e3f6ff", mid="#5ec8ff", dark="#1d6fd8", accent="#8fdcff", bg="#071526"),
    ("MT5", "MT4"): dict(name="green",  light="#e4fff3", mid="#3fd29a", dark="#0f8a5f", accent="#7ff0c1", bg="#06180f"),
    ("MT4", "MT4"): dict(name="orange", light="#fff0dd", mid="#ffa24a", dark="#c4570a", accent="#ffc27d", bg="#1c0f05"),
    ("MT4", "MT5"): dict(name="violet", light="#f1e8ff", mid="#b18cff", dark="#6a3fd6", accent="#cdb3ff", bg="#150b26"),
}


def themed(svg, t):
    # the template is drawn in gold; swap every gold tone for the direction's accent
    for old, new in (("#fff3d1", t["light"]), ("#e9c96d", t["mid"]), ("#b8860b", t["dark"]), ("#d4af37", t["mid"]),
                     ("#f3d27a", t["accent"]), ("#1a1209", t["bg"]), ("#f3c13a", "#f3c13a")):
        svg = svg.replace(old, new)
    return svg


def icon(frm, to):
    return themed(_icon(frm, to), THEMES[(frm, to)])


def _icon(frm, to):
    return f'''<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#060a14"/><stop offset="55%" stop-color="#0d1220"/><stop offset="100%" stop-color="#1a1209"/></linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#fff3d1"/><stop offset="42%" stop-color="#e9c96d"/><stop offset="100%" stop-color="#b8860b"/></linearGradient>
    <linearGradient id="pMT4" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="{PLAT['MT4'][0]}"/><stop offset="100%" stop-color="{PLAT['MT4'][1]}"/></linearGradient>
    <linearGradient id="pMT5" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="{PLAT['MT5'][0]}"/><stop offset="100%" stop-color="{PLAT['MT5'][1]}"/></linearGradient>
    <linearGradient id="link" gradientUnits="userSpaceOnUse" x1="219" y1="0" x2="290" y2="0"><stop offset="0%" stop-color="{PLAT[frm][0]}"/><stop offset="50%" stop-color="#f3d27a"/><stop offset="100%" stop-color="{PLAT[to][0]}"/></linearGradient>
    <radialGradient id="halo" cx="50%" cy="30%" r="60%"><stop offset="0%" stop-color="#d4af37" stop-opacity="0.28"/><stop offset="100%" stop-color="#d4af37" stop-opacity="0"/></radialGradient>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#ffffff" stroke-opacity="0.035" stroke-width="1"/></pattern>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="clip"><rect x="6" y="6" width="500" height="500" rx="80"/></clipPath>
  </defs>
  <rect x="6" y="6" width="500" height="500" rx="80" fill="url(#bg)"/>
  <g clip-path="url(#clip)"><rect width="512" height="512" fill="url(#grid)"/><ellipse cx="256" cy="150" rx="260" ry="170" fill="url(#halo)"/></g>
  <rect x="6" y="6" width="500" height="500" rx="80" fill="none" stroke="url(#gold)" stroke-width="7"/>
  <rect x="19" y="19" width="474" height="474" rx="68" fill="none" stroke="#d4af37" stroke-opacity="0.35" stroke-width="1.2"/>
{terminal(40, 70, frm, "MASTER", False)}
{terminal(296, 70, to, "RECEIVER", True)}
  <!-- copy link -->
  <g filter="url(#glow)">
    <line x1="226" y1="140" x2="286" y2="140" stroke="url(#link)" stroke-width="6" stroke-linecap="round" stroke-dasharray="1 11"/>
    <circle cx="219" cy="140" r="6" fill="{PLAT[frm][0]}"/>
    <path d="M276 122 L300 140 L276 158 Z" fill="url(#gold)"/>
  </g>
  <!-- title block -->
  <text x="256" y="298" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="700" letter-spacing="14" fill="#f3d27a">AT24</text>
  <text x="256" y="352" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="50" font-weight="900" fill="url(#gold)" letter-spacing="1">TRADE COPIER</text>
  <g transform="translate(256 372)"><line x1="-120" y1="0" x2="-14" y2="0" stroke="#d4af37" stroke-opacity="0.6"/><line x1="14" y1="0" x2="120" y2="0" stroke="#d4af37" stroke-opacity="0.6"/><rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" fill="url(#gold)"/></g>
  <!-- direction pill -->
  <rect x="146" y="392" width="220" height="40" rx="20" fill="#0c1322" stroke="#d4af37" stroke-opacity="0.55" stroke-width="1.5"/>
  <rect x="156" y="399" width="62" height="26" rx="13" fill="url(#p{frm})"/><text x="187" y="418" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" fill="#06101d">{frm}</text>
  <path d="M232 412 H272 M262 404 L274 412 L262 420" fill="none" stroke="url(#gold)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="294" y="399" width="62" height="26" rx="13" fill="url(#p{to})"/><text x="325" y="418" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="800" fill="#06101d">{to}</text>
  <text x="256" y="462" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="600" letter-spacing="3" fill="#8da2bd">LOCAL  ·  NO SERVER  ·  NO DLL</text>
</svg>
'''


if __name__ == "__main__":
    html = ['<!doctype html><meta charset="utf-8"><body style="margin:0;background:#1b1f27;display:flex;flex-wrap:wrap;gap:12px;padding:12px">']
    for frm, to in (("MT5", "MT5"), ("MT5", "MT4"), ("MT4", "MT4"), ("MT4", "MT5")):
        svg = icon(frm, to)
        name = "copier-%s-to-%s-icon.svg" % (frm.lower(), to.lower())
        open(os.path.join(HERE, name), "w", encoding="utf-8").write(svg)
        html.append('<img src="%s" width="380" height="380">' % name)
        print(name)
    open(os.path.join(HERE, "preview.html"), "w", encoding="utf-8").write("".join(html))
