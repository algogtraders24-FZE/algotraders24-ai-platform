"""Package the 7 MQL5-wave products for the AT24 website marketplace: zip (licensed .ex5 + README), banner, icon, description text.
usage: python web_pack.py  -> ea-research/marketplace-research/m19-mql5-wave/"""
import os, re, zipfile, shutil, html, json
R = "E:/algotraders24-ai-platform/ea-research"
FI = R + "/lab/FreeIndicators"; L = R + "/lab/MQL5Market/listings"; OUT = R + "/marketplace-research/m19-mql5-wave"
P = [
 # key, wrapper folder, ex5 base, slug, title, id, price, logo, shot, desc html, is_indicator, extra tested text
 ("regime_ai", "RegimeAI", "AT24_RegimeAI_Licensed", "at24-regime-ai", "AT24 Regime AI", "AT24-REGIME-AI", 33, "regime_ai", "AT24_Regime_AI_XAUUSD_H1", "regime_ai", True,
  "The five-state engine matches an independent Python calculation on 5 symbols x 8,000 H1 bars (0 state mismatches) and passed 31 hand-worked unit tests and a no-look-ahead test. The weekly plan uses the same rules as AT24 Position Scanner."),
 ("strategy_fit", "StrategyFit", "AT24_StrategyFit_Licensed", "at24-strategy-fit", "AT24 Strategy Fit", "AT24-STRATEGY-FIT", 33, "strategy_fit", "AT24_Strategy_Fit_XAUUSD_H1", "strategy_fit", True,
  "The signals, trades, statistics and luck test match an independent Python calculation on 5 symbols x 20,000 H1 bars (9,387 trades identical) and passed 26 hand-worked unit tests and a no-look-ahead test."),
 ("position_scanner", "PositionScanner", "AT24_PositionScanner_Licensed", "at24-position-scanner", "AT24 Position Scanner", "AT24-POSITION-SCANNER", 33, "position_scanner", "AT24_Position_Scanner_XAUUSD_H1", "position_scanner", True,
  "The rows use the same engine as AT24 Position Map, which passed 29 hand-worked unit tests and matched an independent Python calculation on real XAUUSD bars (all swings, trends and 27 setups identical) plus a no-look-ahead test."),
 ("csm", "CSM", "AT24_CSM_Licensed", "at24-currency-strength-meter", "AT24 Currency Strength Meter", "AT24-CURRENCY-STRENGTH", 49, "currency_strength_meter", "AT24_Currency_Strength_Meter_XAUUSD_H1", "currency_strength_meter", True,
  "The strength lines match an independent recomputation from the raw 28 pairs on MT5 with no difference (worst 0.00000000). Four bugs found by that check were fixed before release."),
 ("smc", "SmcToolkit", "AT24_SmcToolkit_Licensed", "at24-smc-toolkit", "AT24 SMC Toolkit", "AT24-SMC-TOOLKIT", 59, "smc_toolkit", "AT24_SMC_Toolkit_XAUUSD_H1", "smc_toolkit", True,
  "The three cores (structure, order blocks, gaps) match the earlier verified indicators exactly: 135 values over 9 symbol and timeframe combinations, 0 mismatches."),
 ("trade_manager", "TradeManager", "AT24_Trade_Manager_Licensed", "at24-trade-manager", "AT24 Trade Manager", "AT24-TRADE-MANAGER", 49, "trade_manager", "AT24_Trade_Manager_XAUUSD_H1", "trade_manager", False,
  "Lot size from risk, the order with its stop and target lines, the partial close then break-even move and the daily loss lock were tested in the Strategy Tester on a broker demo feed. The same logic was tested live on a demo account in the MT4 edition, which is not part of this download."),
 ("prop_firm_guard", "PropGuard", "AT24_Prop_Firm_Guard_Licensed", "at24-prop-firm-guard", "AT24 Prop Firm Guard", "AT24-PROP-FIRM-GUARD", 59, "prop_firm_guard", "AT24_Prop_Firm_Guard_XAUUSD_H1", "prop_firm_guard", False,
  "The daily loss lock and the limit warnings were tested in the Strategy Tester on a broker demo feed. Closing positions at a limit has not been tested on a live account."),
]
def plain(h):
    h = re.sub(r"<li>", "- ", h); h = re.sub(r"</li>|</ul>|<br\s*/?>", "\n", h); h = re.sub(r"<b>(.*?)</b>", r"\n\1\n", h); h = re.sub(r"<[^>]+>", "", h)
    h = html.unescape(h); return re.sub(r"\n{3,}", "\n\n", h).strip()
LIC = "\n\nLICENCE KEY: the download is protected by your AT24 licence key. One key works on ONE trading account at a time and only for this product; you can move it to another account yourself (2 changes per 30 days) from Dashboard > Purchases. After buying, paste the key from your purchase page into the EA input \"InpLicenseKey\" and allow https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest. The Strategy Tester needs no key."
os.makedirs(OUT + "/branding", exist_ok=True)
meta = []
for key, wf, ex, slug, title, pid, price, logo, shot, dkey, ind, tested in P:
    d = plain(open("%s/%s_description.html" % (L, dkey), encoding="utf-8").read())
    d = d.replace("Not financial advice.", "Not financial advice. Trading leveraged products is risky.")
    kind = ("It is delivered as a licensed utility Expert Advisor with the indicator built into the file (MetaTrader does not allow licence checks inside indicators): attach it to a chart and the panel appears. It never places orders."
            if ind else "It is delivered as a licensed Expert Advisor file (MetaTrader 5).")
    desc = d + "\n\nWhat was verified: compiles with 0 errors and 0 warnings in the real MetaEditor and runs on a real MT5 chart (see the screenshot) and in the Strategy Tester. " + tested + " Not verified: live-money use, alerts and push messages on a live connected chart, the licence check with a real purchase. MetaTrader 5 only.\n\n" + kind + LIC
    meta.append(dict(slug=slug, title=title, id=pid, price=price, zip="%s_MT5_v1.00.zip" % ex.replace("_Licensed", ""), icon="%s-icon.png" % key, banner="%s-banner.png" % key, tags=["indicator" if ind else "utility", "mt5", "demo-tested", "research" if ind else "risk"], description=desc))
    zn = "%s/%s_MT5_v1.00.zip" % (OUT, ex.replace("_Licensed", ""))
    readme = ("%s - MetaTrader 5 version v1.00 (licensed Expert Advisor file)\n\n" % title.upper()) + d + "\n\nINSTALL (MetaTrader 5)\n1. In MT5 choose File > Open Data Folder, open MQL5 > Experts and copy %s.ex5 into it.\n2. In the Navigator panel right-click Expert Advisors > Refresh.\n3. Allow the licence check once per terminal: Tools > Options > Expert Advisors > tick \"Allow WebRequest for listed URL\" and add https://www.algotraders24.ai\n4. Drag %s from Navigator > Expert Advisors onto a chart. On the Inputs tab paste your licence key into \"InpLicenseKey\" (Dashboard > Purchases > your product).\n5. Keep the Algo Trading button switched on.\n\nLICENCE\n- One key works on ONE trading account at a time and only for this product. You can move it yourself from Dashboard > Purchases (2 changes per 30 days).\n- The only data sent to AT24 is your key, the trading account number, the broker server name and the product name. No trade data leaves your computer.\n- The key is checked at start and every 4 hours; a short internet problem does not stop it (up to 72 hours).\n- The Strategy Tester needs no key.\n\nIMPORTANT\n- Personal use on your own charts. Please do not share your key or the file.\n- Support: support@algotraders24.ai\n" % (ex, ex)
    with zipfile.ZipFile(zn, "w", zipfile.ZIP_DEFLATED) as z:
        z.write("%s/AT24_%s_Wrap_v1/%s.ex5" % (FI, wf, ex) if os.path.exists("%s/AT24_%s_Wrap_v1/%s.ex5" % (FI, wf, ex)) else "%s/AT24_%s_Wrap_v1/%s.ex5" % (FI, wf, ex.replace("_Licensed", "") + "_Licensed"), ex + ".ex5")
        z.writestr("README.txt", readme)
    shutil.copy("%s/%s_logo_400.png" % (L, logo), "%s/branding/%s-icon.png" % (OUT, key))
    shutil.copy("%s/shots/mk_%s.png" % (L, shot), "%s/branding/%s-banner.png" % (OUT, key))
json.dump(meta, open(OUT + "/listings.json", "w"), indent=1)
print(os.listdir(OUT))
