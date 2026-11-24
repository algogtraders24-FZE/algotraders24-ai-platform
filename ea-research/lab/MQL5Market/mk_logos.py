"""Neutral distinct logos (200/140/60) for MQL5 Market listings. usage: python mk_logos.py"""
import os
from PIL import Image, ImageDraw
OUT = "E:/algotraders24-ai-platform/ea-research/lab/MQL5Market/listings"
BG = (10, 22, 40); GOLD = (240, 180, 41); TEAL = (45, 200, 180); WHITE = (235, 240, 245); RED = (230, 90, 90); BLUE = (90, 150, 230)


def base():
    S = 800; k = S / 200
    im = Image.new("RGB", (S, S), BG); d = ImageDraw.Draw(im)
    d.rounded_rectangle([8*k, 8*k, 192*k, 192*k], radius=28*k, outline=GOLD, width=int(4*k))
    return im, d, k


def setup_pro():
    im, d, k = base()
    pts = [(30, 140), (60, 120), (80, 132), (110, 100), (140, 112), (170, 80)]
    d.line([(x*k, y*k) for x, y in pts], fill=WHITE, width=int(4*k), joint="curve")
    for y, c in ((60, TEAL), (96, GOLD), (150, RED)):
        for x in range(40, 170, 16):
            d.line([(x*k, y*k), ((x+9)*k, y*k)], fill=c, width=int(3*k))
    return im


def trade_planner():
    im, d, k = base()
    for y, c in ((52, TEAL), (100, WHITE), (148, RED)):
        d.line([(34*k, y*k), (166*k, y*k)], fill=c, width=int(4*k))
        d.ellipse([(150*k), (y-7)*k, 164*k, (y+7)*k], fill=c)
    d.line([(60*k, 52*k), (60*k, 148*k)], fill=GOLD, width=int(3*k))
    for y in (52, 100, 148):
        d.line([(52*k, y*k), (68*k, y*k)], fill=GOLD, width=int(3*k))
    return im


def heatmap():
    im, d, k = base()
    cols = [[TEAL, (30, 140, 125), RED, (150, 60, 65)], [(30, 140, 125), BLUE, (60, 100, 160), TEAL],
            [RED, (60, 100, 160), TEAL, (150, 60, 65)], [(150, 60, 65), TEAL, (30, 140, 125), BLUE]]
    for r in range(4):
        for c in range(4):
            x0 = 38 + c*31; y0 = 38 + r*31
            d.rectangle([x0*k, y0*k, (x0+27)*k, (y0+27)*k], fill=cols[r][c])
    return im


def corr_shift():
    im, d, k = base()
    a = [(28, 120), (60, 100), (92, 108), (124, 80), (172, 60)]
    b = [(28, 126), (60, 106), (92, 112), (124, 130), (172, 150)]
    d.line([(x*k, y*k) for x, y in a], fill=WHITE, width=int(4*k), joint="curve")
    d.line([(x*k, y*k) for x, y in b], fill=TEAL, width=int(4*k), joint="curve")
    d.line([(124*k, 40*k), (124*k, 170*k)], fill=GOLD, width=int(3*k))
    return im



def vwap():
    im, d, k = base()
    pts = [(30, 120), (60, 100), (90, 112), (120, 84), (170, 70)]
    d.line([(x*k, y*k) for x, y in pts], fill=WHITE, width=int(4*k), joint="curve")
    mid = [(30, 130), (70, 118), (110, 106), (170, 92)]
    d.line([(x*k, y*k) for x, y in mid], fill=GOLD, width=int(4*k), joint="curve")
    for off in (-28, 28):
        d.line([(x*k, (y+off)*k) for x, y in mid], fill=TEAL, width=int(2*k))
    return im


def candles():
    im, d, k = base()
    data = [(44, 100, 130, 80, 150, RED), (76, 90, 120, 70, 140, TEAL), (108, 70, 110, 55, 125, TEAL), (140, 60, 95, 45, 110, TEAL)]
    for x, t, b, hi, lo, c in data:
        d.line([(x*k, hi*k), (x*k, lo*k)], fill=WHITE, width=int(3*k))
        d.rectangle([(x-10)*k, t*k, (x+10)*k, b*k], fill=c)
    return im


def clock():
    im, d, k = base()
    d.ellipse([46*k, 46*k, 154*k, 154*k], outline=WHITE, width=int(5*k))
    d.line([(100*k, 100*k), (100*k, 64*k)], fill=GOLD, width=int(5*k))
    d.line([(100*k, 100*k), (128*k, 112*k)], fill=TEAL, width=int(5*k))
    for a in range(12):
        import math
        x1 = 100 + 46*math.sin(a*math.pi/6); y1 = 100 - 46*math.cos(a*math.pi/6)
        x2 = 100 + 40*math.sin(a*math.pi/6); y2 = 100 - 40*math.cos(a*math.pi/6)
        d.line([(x1*k, y1*k), (x2*k, y2*k)], fill=WHITE, width=int(2*k))
    return im


def edge_test():
    im, d, k = base()
    import math
    pts = [(30 + i*4, 150 - 90*math.exp(-((i-35)/12.0)**2)) for i in range(36)]
    pts2 = [(30 + i*4, 150 - 90*math.exp(-((i-35)/12.0)**2)) for i in range(0, 36)]
    d.line([(x*k, y*k) for x, y in pts2], fill=TEAL, width=int(4*k), joint="curve")
    d.line([(100*k, 50*k), (100*k, 150*k)], fill=GOLD, width=int(3*k))
    d.line([(30*k, 150*k), (170*k, 150*k)], fill=WHITE, width=int(3*k))
    d.ellipse([130*k, 112*k, 142*k, 124*k], fill=RED)
    return im


def hour_bias():
    im, d, k = base()
    vals = [10, -6, 14, 22, -10, 8, -16, 18, 6, -12, 20, 12]
    for i, v in enumerate(vals):
        x0 = 34 + i*11
        c = TEAL if v >= 0 else RED
        d.rectangle([x0*k, (100-max(v, 0))*k, (x0+8)*k, (100+max(-v, 0))*k], fill=c)
    d.line([(30*k, 100*k), (170*k, 100*k)], fill=WHITE, width=int(2*k))
    d.rectangle([34*k, 150*k, 166*k, 158*k], outline=GOLD, width=int(2*k))
    return im



def drawdown():
    im, d, k = base()
    pts = [(30, 70), (60, 60), (90, 110), (120, 140), (150, 110), (170, 84)]
    d.line([(x*k, y*k) for x, y in pts], fill=WHITE, width=int(4*k), joint="curve")
    d.line([(30*k, 60*k), (170*k, 60*k)], fill=GOLD, width=int(2*k))
    d.line([(120*k, 60*k), (120*k, 140*k)], fill=RED, width=int(3*k))
    return im


def ledger():
    im, d, k = base()
    for i, y in enumerate((52, 80, 108, 136)):
        d.rectangle([40*k, y*k, 160*k, (y+18)*k], outline=WHITE, width=int(2*k))
        d.rectangle([46*k, (y+5)*k, (46+[30, 54, 20, 8][i])*k, (y+13)*k], fill=TEAL if i < 2 else BLUE)
    d.line([(100*k, 40*k), (100*k, 160*k)], fill=GOLD, width=int(3*k))
    return im


def doctor():
    im, d, k = base()
    d.rectangle([84*k, 52*k, 116*k, 148*k], fill=TEAL)
    d.rectangle([52*k, 84*k, 148*k, 116*k], fill=TEAL)
    d.rectangle([92*k, 60*k, 108*k, 140*k], fill=BG)
    d.rectangle([60*k, 92*k, 140*k, 108*k], fill=BG)
    return im


def persistence():
    im, d, k = base()
    a = [(30, 130), (60, 110), (90, 120), (120, 90), (170, 70)]
    b = [(30, 70), (60, 90), (90, 80), (120, 110), (170, 130)]
    d.line([(x*k, y*k) for x, y in a], fill=TEAL, width=int(4*k), joint="curve")
    d.line([(x*k, y*k) for x, y in b], fill=WHITE, width=int(4*k), joint="curve")
    d.line([(30*k, 100*k), (170*k, 100*k)], fill=GOLD, width=int(2*k))
    return im


def streak():
    im, d, k = base()
    cols = [RED, RED, RED, TEAL, TEAL, RED]
    for i, c in enumerate(cols):
        x = 34 + i*22
        d.rectangle([x*k, (60 + (i % 3)*12)*k, (x+16)*k, (120 + (i % 2)*14)*k], fill=c)
    d.line([(30*k, 150*k), (170*k, 150*k)], fill=GOLD, width=int(3*k))
    return im


def volfc():
    im, d, k = base()
    pts = [(30, 110), (60, 100), (90, 106), (110, 100)]
    d.line([(x*k, y*k) for x, y in pts], fill=WHITE, width=int(4*k), joint="curve")
    d.polygon([(110*k, 100*k), (170*k, 62*k), (170*k, 138*k)], outline=TEAL)
    d.line([(110*k, 100*k), (170*k, 62*k)], fill=TEAL, width=int(3*k))
    d.line([(110*k, 100*k), (170*k, 138*k)], fill=TEAL, width=int(3*k))
    d.line([(110*k, 100*k), (170*k, 100*k)], fill=GOLD, width=int(2*k))
    return im


def gap():
    im, d, k = base()
    d.line([(30*k, 110*k), (80*k, 90*k)], fill=WHITE, width=int(4*k))
    d.line([(120*k, 60*k), (170*k, 76*k)], fill=WHITE, width=int(4*k))
    d.rectangle([80*k, 60*k, 120*k, 90*k], outline=GOLD, width=int(3*k))
    d.line([(80*k, 90*k), (120*k, 90*k)], fill=GOLD, width=int(3*k))
    return im


def trade_manager():
    im, d, k = base()
    d.rectangle([40*k, 44*k, 160*k, 156*k], outline=WHITE, width=int(3*k))
    d.rectangle([48*k, 52*k, 100*k, 80*k], fill=TEAL)
    d.rectangle([104*k, 52*k, 152*k, 80*k], fill=RED)
    for y in (96, 114, 132):
        d.line([(48*k, y*k), (152*k, y*k)], fill=GOLD if y == 114 else BLUE, width=int(3*k))
    return im


def prop_guard():
    im, d, k = base()
    d.polygon([(100*k, 40*k), (150*k, 58*k), (150*k, 104*k), (100*k, 160*k), (50*k, 104*k), (50*k, 58*k)], outline=WHITE, width=int(4*k))
    d.line([(50*k, 112*k), (150*k, 112*k)], fill=RED, width=int(3*k))
    d.rectangle([68*k, 72*k, 132*k, 90*k], fill=TEAL)
    d.line([(100*k, 40*k), (100*k, 160*k)], fill=GOLD, width=int(2*k))
    return im


def currency_strength():
    im, d, k = base()
    cols = [TEAL, WHITE, RED, GOLD, BLUE]
    import math
    for j, c in enumerate(cols):
        pts = [(34 + i*8, 100 + 38*math.sin(i*0.55 + j*1.3)*(1 - j*0.12)) for i in range(18)]
        d.line([(x*k, y*k) for x, y in pts], fill=c, width=int(3*k), joint="curve")
    d.line([(30*k, 100*k), (172*k, 100*k)], fill=(60, 75, 95), width=int(2*k))
    return im


def smc_toolkit():
    im, d, k = base()
    d.rectangle([36*k, 118*k, 112*k, 138*k], fill=(30, 120, 70))
    d.rectangle([88*k, 60*k, 164*k, 80*k], fill=(140, 50, 50))
    pts = [(30, 150), (62, 112), (92, 124), (128, 82), (170, 50)]
    d.line([(x*k, y*k) for x, y in pts], fill=WHITE, width=int(4*k), joint="curve")
    d.line([(98*k, 96*k), (150*k, 96*k)], fill=GOLD, width=int(3*k))
    return im


def local_copier():
    im, d, k = base()
    d.rounded_rectangle([30*k, 62*k, 86*k, 138*k], radius=6*k, outline=WHITE, width=int(3*k))
    d.rounded_rectangle([114*k, 62*k, 170*k, 138*k], radius=6*k, outline=WHITE, width=int(3*k))
    for y in (82, 100, 118):
        d.line([(40*k, y*k), (76*k, y*k)], fill=TEAL, width=int(3*k))
        d.line([(124*k, y*k), (160*k, y*k)], fill=GOLD, width=int(3*k))
    d.line([(90*k, 100*k), (110*k, 100*k)], fill=RED, width=int(4*k))
    d.polygon([(110*k, 92*k), (118*k, 100*k), (110*k, 108*k)], fill=RED)
    return im


def regime_ai():
    im, d, k = base()
    cols = [(120,130,150), BLUE, RED, TEAL, GOLD]
    hs = [30, 70, 100, 44, 80]
    for i, (c, h) in enumerate(zip(cols, hs)):
        x = 34 + i*28
        d.rounded_rectangle([x*k, (150-h)*k, (x+22)*k, 150*k], radius=4*k, fill=c)
    return im


def strategy_fit():
    im, d, k = base()
    for r, y in enumerate((70, 100, 130)):
        for c, x in enumerate((40, 78, 116, 154)):
            col = TEAL if (r + c) % 4 == 0 else (RED if (r * 2 + c) % 5 == 0 else (70, 85, 108))
            d.rounded_rectangle([(x-14)*k, (y-11)*k, (x+14)*k, (y+11)*k], radius=4*k, fill=col)
    return im


def position_scanner():
    im, d, k = base()
    for i, y in enumerate((52, 82, 112, 142)):
        d.rounded_rectangle([30*k, (y-10)*k, 170*k, (y+10)*k], radius=4*k, outline=(70, 85, 108), width=int(2*k))
        d.polygon([(40*k, (y+5)*k), (50*k, (y-5)*k), (60*k, (y+5)*k)] if i % 2 == 0 else [(40*k, (y-5)*k), (50*k, (y+5)*k), (60*k, (y-5)*k)], fill=TEAL if i % 2 == 0 else RED)
        d.line([(76*k, y*k), ((100 + i*14)*k, y*k)], fill=GOLD, width=int(3*k))
    return im


def basket_closer():
    im, d, k = base()
    for i, (y, c) in enumerate(((60, TEAL), (88, RED), (116, TEAL), (144, RED))):
        d.rounded_rectangle([34*k, (y-9)*k, 120*k, (y+9)*k], radius=4*k, fill=(40, 55, 75), outline=c, width=int(2*k))
    d.line([(132*k, 52*k), (132*k, 152*k)], fill=GOLD, width=int(3*k))
    d.polygon([(132*k, 152*k), (124*k, 138*k), (140*k, 138*k)], fill=GOLD)
    d.line([(150*k, 100*k), (172*k, 100*k)], fill=WHITE, width=int(4*k))
    return im


for n, f in (("setup_pro", setup_pro), ("trade_planner", trade_planner), ("market_heatmap", heatmap), ("correlation_shift", corr_shift), ("anchored_vwap", vwap), ("candle_pattern_lab", candles), ("cost_clock", clock), ("edge_truth_test", edge_test), ("hour_bias_map", hour_bias), ("drawdown_recovery", drawdown), ("forward_ledger", ledger), ("history_doctor", doctor), ("persistence_meter", persistence), ("streak_meter", streak), ("volatility_forecast", volfc), ("weekend_gap_tracker", gap), ("trade_manager", trade_manager), ("prop_firm_guard", prop_guard), ("currency_strength_meter", currency_strength), ("smc_toolkit", smc_toolkit), ("local_copier", local_copier), ("regime_ai", regime_ai), ("strategy_fit", strategy_fit), ("position_scanner", position_scanner), ("basket_closer", basket_closer)):
    im = f()
    for s in (400, 200, 140, 60):
        im.resize((s, s), Image.LANCZOS).save("%s/%s_logo_%d.png" % (OUT, n, s))
print("ok")
