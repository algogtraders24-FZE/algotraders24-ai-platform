"""
Spec -> classic MQL4 (MT4) EA source. Same indicator math + entry logic as
codegen_mql5.py/indicators.py, but MQL4 syntax is genuinely different, not
just a renamed MQL5: no indicator handles/CopyBuffer (iMA/iRSI/... take the
shift directly and return the value), no MqlTradeRequest (OrderSend takes
positional args), and price series are the built-in High[]/Low[]/Close[]/
Time[] arrays rather than iHigh()/iLow()/iClose() calls. shift=1 is the
last CLOSED bar in both MQL4 and MQL5, so the closed-bar convention (the
repaint-bug fix from the original EA) carries over unchanged.
"""

import re

PRICE_REFS = {"close", "open", "high", "low"}

# Q1.4 Part 18 - see codegen_mql5.py's identical comment: the strategy
# `name` is free display text embedded into a source comment and a
# quoted MQL string literal (OrderSend's comment arg) - a `"` in the name
# was confirmed to break out and inject compilable MQL.
_UNSAFE_NAME_CHARS = re.compile(r'[^A-Za-z0-9 _\-.,()]')


def _sanitize_name(name, default="Generated Strategy", max_len=80):
    name = str(name) if name else default
    name = name.replace("\n", " ").replace("\r", " ")
    name = _UNSAFE_NAME_CHARS.sub("", name).strip()
    return name[:max_len] or default


def _var_name(ref):
    if isinstance(ref, (int, float)):
        return str(ref)
    if ref in PRICE_REFS:
        return {"close": "closeC", "open": "openC", "high": "highC", "low": "lowC"}[ref]
    if "." in ref:
        base, field = ref.split(".")
        return f"{base}_{field}"
    return ref


def _cond_to_mql4(cond):
    left, op, right = cond["left"], cond["op"], cond["right"]
    lv, rv = _var_name(left), _var_name(right)
    if op in (">", "<", ">=", "<=", "=="):
        opsym = "==" if op == "==" else op
        return f"({lv} {opsym} {rv})"
    if op == "cross_above":
        return f"({lv}_prev <= {rv}_prev && {lv} > {rv})"
    if op == "cross_below":
        return f"({lv}_prev >= {rv}_prev && {lv} < {rv})"
    raise ValueError(op)


def _supertrend_block(iid, period, mult, lookback):
    n = lookback
    return f"""
   double {iid}_finalUpper[], {iid}_finalLower[];
   double {iid}_lineArr[]; int {iid}_trendArr[];
   ArrayResize({iid}_finalUpper, {n}); ArrayResize({iid}_finalLower, {n});
   ArrayResize({iid}_lineArr, {n}); ArrayResize({iid}_trendArr, {n});
   for(int _i = {n}-1; _i >= 0; _i--)
     {{
      int _shift = _i + 1;  // shift=1 is last closed bar; _i={n}-1 -> oldest of the window
      double _atrVal = iATR(Symbol(), 0, {period}, _shift);
      double hl2 = (High[_shift] + Low[_shift]) / 2.0;
      double basicUpper = hl2 + {mult} * _atrVal;
      double basicLower = hl2 - {mult} * _atrVal;
      if(_i == {n}-1)
        {{
         {iid}_finalUpper[_i] = basicUpper; {iid}_finalLower[_i] = basicLower;
         {iid}_lineArr[_i] = basicUpper; {iid}_trendArr[_i] = 1;
         continue;
        }}
      double prevClose = Close[_shift+1];
      {iid}_finalUpper[_i] = (basicUpper < {iid}_finalUpper[_i+1] || prevClose > {iid}_finalUpper[_i+1])
                              ? basicUpper : {iid}_finalUpper[_i+1];
      {iid}_finalLower[_i] = (basicLower > {iid}_finalLower[_i+1] || prevClose < {iid}_finalLower[_i+1])
                              ? basicLower : {iid}_finalLower[_i+1];
      double prevLine = {iid}_lineArr[_i+1];
      double curClose = Close[_shift];
      if(prevLine == {iid}_finalUpper[_i+1])
        {{
         if(curClose <= {iid}_finalUpper[_i]) {{ {iid}_lineArr[_i] = {iid}_finalUpper[_i]; {iid}_trendArr[_i] = -1; }}
         else {{ {iid}_lineArr[_i] = {iid}_finalLower[_i]; {iid}_trendArr[_i] = 1; }}
        }}
      else
        {{
         if(curClose >= {iid}_finalLower[_i]) {{ {iid}_lineArr[_i] = {iid}_finalLower[_i]; {iid}_trendArr[_i] = 1; }}
         else {{ {iid}_lineArr[_i] = {iid}_finalUpper[_i]; {iid}_trendArr[_i] = -1; }}
        }}
     }}""".strip("\n")


def _macd_signal_block(iid, fast, slow, signal_period, lookback):
    """Recomputes the EMA-smoothed MACD signal line from the MACD-line
    values (fetched fresh per shift via iMACD's MODE_MAIN, which is
    correct/EMA-based unlike MODE_SIGNAL) — see the MACD branch in
    _reads(). Seeding the oldest window bar with the raw MACD value
    matches pandas' ewm(adjust=False) in indicators.py exactly."""
    n = lookback
    return f"""
   double {iid}_sigArr[];
   ArrayResize({iid}_sigArr, {n});
   double {iid}_alpha = 2.0 / ({signal_period} + 1.0);
   for(int _i = {n}-1; _i >= 0; _i--)
     {{
      int _shift = _i + 1;
      double _macdVal = iMACD(Symbol(), 0, {fast}, {slow}, {signal_period}, PRICE_CLOSE, MODE_MAIN, _shift);
      if(_i == {n}-1)
         {iid}_sigArr[_i] = _macdVal;
      else
         {iid}_sigArr[_i] = {iid}_alpha * _macdVal + (1.0 - {iid}_alpha) * {iid}_sigArr[_i+1];
     }}""".strip("\n")


def _reads(indicators):
    read_cur, read_prev = [], []
    for ind in indicators:
        iid, t = ind["id"], ind["type"]

        if t == "EMA":
            p = ind["period"]
            read_cur.append(f"double {iid} = iMA(Symbol(), 0, {p}, 0, MODE_EMA, PRICE_CLOSE, 1);")
            read_prev.append(f"double {iid}_prev = iMA(Symbol(), 0, {p}, 0, MODE_EMA, PRICE_CLOSE, 2);")
        elif t == "SMA":
            p = ind["period"]
            read_cur.append(f"double {iid} = iMA(Symbol(), 0, {p}, 0, MODE_SMA, PRICE_CLOSE, 1);")
            read_prev.append(f"double {iid}_prev = iMA(Symbol(), 0, {p}, 0, MODE_SMA, PRICE_CLOSE, 2);")
        elif t == "RSI":
            p = ind["period"]
            read_cur.append(f"double {iid} = iRSI(Symbol(), 0, {p}, PRICE_CLOSE, 1);")
            read_prev.append(f"double {iid}_prev = iRSI(Symbol(), 0, {p}, PRICE_CLOSE, 2);")
        elif t == "ATR":
            p = ind["period"]
            read_cur.append(f"double {iid} = iATR(Symbol(), 0, {p}, 1);")
            read_prev.append(f"double {iid}_prev = iATR(Symbol(), 0, {p}, 2);")
        elif t == "MACD":
            # MetaTrader's built-in iMACD signal buffer is SMA-smoothed (a
            # MetaTrader-specific quirk); indicators.py/Pine both use the
            # standard EMA-smoothed signal line, so it's recomputed manually
            # from the (correct) MACD line — see codegen_mql5.py's identical
            # reasoning.
            fast, slow, sig = ind.get("fast", 12), ind.get("slow", 26), ind.get("signal", 9)
            lookback = max(100, sig * 10)
            read_cur.append(f"double {iid}_line = iMACD(Symbol(), 0, {fast}, {slow}, {sig}, PRICE_CLOSE, MODE_MAIN, 1);")
            read_cur.append(_macd_signal_block(iid, fast, slow, sig, lookback))
            read_cur.append(f"double {iid}_signal = {iid}_sigArr[0];")
            read_cur.append(f"double {iid}_hist = {iid}_line - {iid}_signal;")
            read_prev.append(f"double {iid}_line_prev = iMACD(Symbol(), 0, {fast}, {slow}, {sig}, PRICE_CLOSE, MODE_MAIN, 2);")
            read_prev.append(f"double {iid}_signal_prev = {iid}_sigArr[1];")
        elif t == "BB":
            period, mult = ind.get("period", 20), ind.get("mult", 2.0)
            read_cur.append(f"double {iid}_middle = iBands(Symbol(), 0, {period}, {mult}, 0, PRICE_CLOSE, MODE_MAIN, 1);")
            read_cur.append(f"double {iid}_upper = iBands(Symbol(), 0, {period}, {mult}, 0, PRICE_CLOSE, MODE_UPPER, 1);")
            read_cur.append(f"double {iid}_lower = iBands(Symbol(), 0, {period}, {mult}, 0, PRICE_CLOSE, MODE_LOWER, 1);")
            read_prev.append(f"double {iid}_middle_prev = iBands(Symbol(), 0, {period}, {mult}, 0, PRICE_CLOSE, MODE_MAIN, 2);")
            read_prev.append(f"double {iid}_upper_prev = iBands(Symbol(), 0, {period}, {mult}, 0, PRICE_CLOSE, MODE_UPPER, 2);")
            read_prev.append(f"double {iid}_lower_prev = iBands(Symbol(), 0, {period}, {mult}, 0, PRICE_CLOSE, MODE_LOWER, 2);")
        elif t == "STOCH":
            # slowing=1, not the usual 3 — see codegen_mql5.py's identical
            # comment; this makes MODE_MAIN the raw %K matching indicators.py
            kp, dp = ind.get("k_period", 14), ind.get("d_period", 3)
            read_cur.append(f"double {iid}_k = iStochastic(Symbol(), 0, {kp}, {dp}, 1, MODE_SMA, 0, MODE_MAIN, 1);")
            read_cur.append(f"double {iid}_d = iStochastic(Symbol(), 0, {kp}, {dp}, 1, MODE_SMA, 0, MODE_SIGNAL, 1);")
            read_prev.append(f"double {iid}_k_prev = iStochastic(Symbol(), 0, {kp}, {dp}, 1, MODE_SMA, 0, MODE_MAIN, 2);")
            read_prev.append(f"double {iid}_d_prev = iStochastic(Symbol(), 0, {kp}, {dp}, 1, MODE_SMA, 0, MODE_SIGNAL, 2);")
        elif t == "ADX":
            p = ind.get("period", 14)
            read_cur.append(f"double {iid}_adx = iADX(Symbol(), 0, {p}, PRICE_CLOSE, MODE_MAIN, 1);")
            read_cur.append(f"double {iid}_plus_di = iADX(Symbol(), 0, {p}, PRICE_CLOSE, MODE_PLUSDI, 1);")
            read_cur.append(f"double {iid}_minus_di = iADX(Symbol(), 0, {p}, PRICE_CLOSE, MODE_MINUSDI, 1);")
            read_prev.append(f"double {iid}_adx_prev = iADX(Symbol(), 0, {p}, PRICE_CLOSE, MODE_MAIN, 2);")
            read_prev.append(f"double {iid}_plus_di_prev = iADX(Symbol(), 0, {p}, PRICE_CLOSE, MODE_PLUSDI, 2);")
            read_prev.append(f"double {iid}_minus_di_prev = iADX(Symbol(), 0, {p}, PRICE_CLOSE, MODE_MINUSDI, 2);")
        elif t == "DONCHIAN":
            # window starts at shift 2 (resp. 3), excluding the reference
            # bar's own high/low from its own channel — see codegen_mql5.py
            period = ind.get("period", 20)
            read_cur.append(f"int {iid}_hi_idx = iHighest(Symbol(), 0, MODE_HIGH, {period}, 2);")
            read_cur.append(f"int {iid}_lo_idx = iLowest(Symbol(), 0, MODE_LOW, {period}, 2);")
            read_cur.append(f"double {iid}_upper = High[{iid}_hi_idx];")
            read_cur.append(f"double {iid}_lower = Low[{iid}_lo_idx];")
            read_cur.append(f"double {iid}_middle = ({iid}_upper + {iid}_lower) / 2.0;")
            read_prev.append(f"int {iid}_hi_idx_prev = iHighest(Symbol(), 0, MODE_HIGH, {period}, 3);")
            read_prev.append(f"int {iid}_lo_idx_prev = iLowest(Symbol(), 0, MODE_LOW, {period}, 3);")
            read_prev.append(f"double {iid}_upper_prev = High[{iid}_hi_idx_prev];")
            read_prev.append(f"double {iid}_lower_prev = Low[{iid}_lo_idx_prev];")
            read_prev.append(f"double {iid}_middle_prev = ({iid}_upper_prev + {iid}_lower_prev) / 2.0;")
        elif t == "SUPERTREND":
            period, mult = ind.get("period", 10), ind.get("mult", 3.0)
            lookback = max(150, period * 15)
            read_cur.append(_supertrend_block(iid, period, mult, lookback))
            read_prev.append(f"double {iid}_line_prev = {iid}_lineArr[1]; int {iid}_trend_prev = {iid}_trendArr[1];")
            read_cur.append(f"double {iid}_line = {iid}_lineArr[0]; int {iid}_trend = {iid}_trendArr[0];")
        else:
            raise ValueError(f"unsupported indicator type {t}")

    return read_cur, read_prev


def generate_mql4(spec: dict) -> str:
    indicators = spec["indicators"]
    read_cur, read_prev = _reads(indicators)

    long_conds = spec.get("entry_long", [])
    short_conds = spec.get("entry_short", [])
    long_expr = " && ".join(_cond_to_mql4(c) for c in long_conds) if long_conds else "false"
    short_expr = " && ".join(_cond_to_mql4(c) for c in short_conds) if short_conds else "false"

    risk = spec.get("risk", {})
    atr_id = risk.get("atr_id")
    sl_mode, tp_mode = risk.get("sl_mode", "ATR"), risk.get("tp_mode", "ATR")
    # "PIPS" mode's sl_points/tp_points is a raw price-unit distance (see
    # schema.py's docstring) — default 3.0/6.0 matches runner.py exactly.
    sl_expr = f"{atr_id} * {risk.get('sl_atr_mult', 2.0)}" if sl_mode == "ATR" else str(risk.get("sl_points", 3.0))
    tp_expr = f"{atr_id} * {risk.get('tp_atr_mult', 4.0)}" if tp_mode == "ATR" else str(risk.get("tp_points", 6.0))

    display_name = _sanitize_name(spec.get("name"))
    name = display_name.replace(" ", "")

    return f"""//+------------------------------------------------------------------+
//| {display_name} — AUTO-GENERATED from spec (MQL4/MT4)   |
//| Generated by the AT24 idea-to-code engine. Review before live use. |
//+------------------------------------------------------------------+
#property strict
extern double InpRiskPercent = 1.0;
extern int    InpMagic       = 900001;

datetime g_lastBarTime = 0;

bool HasOpenPosition()
  {{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {{
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() == Symbol() && OrderMagicNumber() == InpMagic)
         return(true);
     }}
   return(false);
  }}

double CalcLots(double slDist)
  {{
   double riskMoney = AccountBalance() * (InpRiskPercent / 100.0);
   double tickValue = MarketInfo(Symbol(), MODE_TICKVALUE);
   double tickSize  = MarketInfo(Symbol(), MODE_TICKSIZE);
   if(tickSize <= 0) tickSize = Point;
   double lossPerLot = (slDist / tickSize) * tickValue;
   if(lossPerLot <= 0) return(0);
   double lots = riskMoney / lossPerLot;
   double minLot = MarketInfo(Symbol(), MODE_MINLOT), step = MarketInfo(Symbol(), MODE_LOTSTEP);
   lots = MathFloor(lots / step) * step;
   return(MathMax(minLot, lots));
  }}

void OpenTrade(int direction, double slDist, double tpDist)
  {{
   double price = (direction > 0) ? Ask : Bid;
   double sl = price - direction * slDist;
   double tp = price + direction * tpDist;
   double lots = CalcLots(slDist);
   if(lots <= 0) return;

   int cmd = (direction > 0) ? OP_BUY : OP_SELL;
   int ticket = OrderSend(Symbol(), cmd, lots, price, 20,
                           NormalizeDouble(sl, Digits), NormalizeDouble(tp, Digits),
                           "{name}", InpMagic, 0, (direction > 0) ? clrBlue : clrRed);
  }}

void OnTick()
  {{
   if(Time[0] == g_lastBarTime) return;
   g_lastBarTime = Time[0];
   if(HasOpenPosition()) return;

   double closeC = Close[1];
   double openC  = Open[1];
   double highC  = High[1];
   double lowC   = Low[1];
   double closeC_prev = Close[2];
   double openC_prev  = Open[2];
   double highC_prev  = High[2];
   double lowC_prev   = Low[2];

{chr(10).join('   ' + l for l in read_cur)}
{chr(10).join('   ' + l for l in read_prev)}

   bool longSignal  = {long_expr};
   bool shortSignal = {short_expr};

   if(longSignal)
      OpenTrade(1, {sl_expr}, {tp_expr});
   else if(shortSignal)
      OpenTrade(-1, {sl_expr}, {tp_expr});
  }}
"""
