"""
Spec -> compilable MQL5 EA source. Mirrors the same indicator math and
condition logic as indicators.py/interpreter.py so a generated EA's
live behavior matches the Python-verified backtest.
"""

PRICE_REFS = {"close", "open", "high", "low"}


def _var_name(ref):
    if isinstance(ref, (int, float)):
        return str(ref)
    if ref in PRICE_REFS:
        return {"close": "closeC", "open": "openC", "high": "highC", "low": "lowC"}[ref]
    if "." in ref:
        base, field = ref.split(".")
        return f"{base}_{field}"
    return ref


def _handles_and_reads(indicators):
    """Returns (handle_decls, init_lines, read_cur_lines, read_prev_lines, deinit_lines)."""
    handle_decls, init_lines, read_cur, read_prev, deinit_lines = [], [], [], [], []

    for ind in indicators:
        iid, t = ind["id"], ind["type"]
        h = f"h_{iid}"
        handle_decls.append(f"int {h};")
        deinit_lines.append(f"IndicatorRelease({h});")

        if t == "EMA":
            init_lines.append(f'{h} = iMA(_Symbol, PERIOD_CURRENT, {ind["period"]}, 0, MODE_EMA, PRICE_CLOSE);')
            read_cur.append(f"double {iid}; if(!GetBuf({h},1,{iid})) return;")
            read_prev.append(f"double {iid}_prev; if(!GetBuf({h},2,{iid}_prev)) return;")
        elif t == "SMA":
            init_lines.append(f'{h} = iMA(_Symbol, PERIOD_CURRENT, {ind["period"]}, 0, MODE_SMA, PRICE_CLOSE);')
            read_cur.append(f"double {iid}; if(!GetBuf({h},1,{iid})) return;")
            read_prev.append(f"double {iid}_prev; if(!GetBuf({h},2,{iid}_prev)) return;")
        elif t == "RSI":
            init_lines.append(f'{h} = iRSI(_Symbol, PERIOD_CURRENT, {ind["period"]}, PRICE_CLOSE);')
            read_cur.append(f"double {iid}; if(!GetBuf({h},1,{iid})) return;")
            read_prev.append(f"double {iid}_prev; if(!GetBuf({h},2,{iid}_prev)) return;")
        elif t == "ATR":
            init_lines.append(f'{h} = iATR(_Symbol, PERIOD_CURRENT, {ind["period"]});')
            read_cur.append(f"double {iid}; if(!GetBuf({h},1,{iid})) return;")
            read_prev.append(f"double {iid}_prev; if(!GetBuf({h},2,{iid}_prev)) return;")
        elif t == "MACD":
            # MetaTrader's built-in iMACD signal buffer is SMA-smoothed
            # (a MetaTrader-specific quirk); indicators.py/Pine both use the
            # standard EMA-smoothed signal line. Reading the built-in signal
            # buffer directly would fire cross_above/cross_below on
            # different bars than the Python-backtested/Pine version, so the
            # signal line is recomputed manually from the (correct) MACD
            # line buffer using the same EMA recurrence as indicators.py.
            fast, slow, sig = ind.get("fast", 12), ind.get("slow", 26), ind.get("signal", 9)
            init_lines.append(f'{h} = iMACD(_Symbol, PERIOD_CURRENT, {fast}, {slow}, {sig}, PRICE_CLOSE);')
            lookback = max(100, sig * 10)
            read_cur.append(f"double {iid}_line; if(!GetBufN({h},0,1,{iid}_line)) return;")
            read_cur.append(_macd_signal_block_mql5(iid, h, sig, lookback))
            read_cur.append(f"double {iid}_signal = {iid}_sigArr[0];")
            read_cur.append(f"double {iid}_hist = {iid}_line - {iid}_signal;")
            read_prev.append(f"double {iid}_line_prev; if(!GetBufN({h},0,2,{iid}_line_prev)) return;")
            read_prev.append(f"double {iid}_signal_prev = {iid}_sigArr[1];")
        elif t == "BB":
            period, mult = ind.get("period", 20), ind.get("mult", 2.0)
            init_lines.append(f'{h} = iBands(_Symbol, PERIOD_CURRENT, {period}, 0, {mult}, PRICE_CLOSE);')
            read_cur.append(f"double {iid}_middle; if(!GetBufN({h},0,1,{iid}_middle)) return;")
            read_cur.append(f"double {iid}_upper; if(!GetBufN({h},1,1,{iid}_upper)) return;")
            read_cur.append(f"double {iid}_lower; if(!GetBufN({h},2,1,{iid}_lower)) return;")
            read_prev.append(f"double {iid}_middle_prev; if(!GetBufN({h},0,2,{iid}_middle_prev)) return;")
            read_prev.append(f"double {iid}_upper_prev; if(!GetBufN({h},1,2,{iid}_upper_prev)) return;")
            read_prev.append(f"double {iid}_lower_prev; if(!GetBufN({h},2,2,{iid}_lower_prev)) return;")
        elif t == "STOCH":
            # slowing=1 (not the usual default of 3) so MODE_MAIN is the raw
            # /fast %K and MODE_SIGNAL is SMA(raw %K, d_period) — matching
            # indicators.py's stochastic() and codegen_pine.py's ta.stoch()
            # exactly. slowing=3 would compute "Slow Stochastic", a
            # different series that crosses on different bars.
            kp, dp = ind.get("k_period", 14), ind.get("d_period", 3)
            init_lines.append(f'{h} = iStochastic(_Symbol, PERIOD_CURRENT, {kp}, {dp}, 1, MODE_SMA, STO_LOWHIGH);')
            read_cur.append(f"double {iid}_k; if(!GetBufN({h},0,1,{iid}_k)) return;")
            read_cur.append(f"double {iid}_d; if(!GetBufN({h},1,1,{iid}_d)) return;")
            read_prev.append(f"double {iid}_k_prev; if(!GetBufN({h},0,2,{iid}_k_prev)) return;")
            read_prev.append(f"double {iid}_d_prev; if(!GetBufN({h},1,2,{iid}_d_prev)) return;")
        elif t == "ADX":
            period = ind.get("period", 14)
            init_lines.append(f'{h} = iADX(_Symbol, PERIOD_CURRENT, {period});')
            read_cur.append(f"double {iid}_adx; if(!GetBufN({h},0,1,{iid}_adx)) return;")
            read_cur.append(f"double {iid}_plus_di; if(!GetBufN({h},1,1,{iid}_plus_di)) return;")
            read_cur.append(f"double {iid}_minus_di; if(!GetBufN({h},2,1,{iid}_minus_di)) return;")
            read_prev.append(f"double {iid}_adx_prev; if(!GetBufN({h},0,2,{iid}_adx_prev)) return;")
            read_prev.append(f"double {iid}_plus_di_prev; if(!GetBufN({h},1,2,{iid}_plus_di_prev)) return;")
            read_prev.append(f"double {iid}_minus_di_prev; if(!GetBufN({h},2,2,{iid}_minus_di_prev)) return;")
        elif t == "DONCHIAN":
            # No built-in MT5 indicator — iHighest/iLowest give the bar
            # index of the extreme over the window; read price at that index.
            # Window starts at shift 2 (resp. 3 for the prev read), NOT
            # shift 1, so the reference bar's own high/low is excluded from
            # its own channel — matches indicators.py's shift(1)-then-roll
            # (a channel that counted today's own high would make "close >
            # upper" nearly impossible to ever trigger).
            period = ind.get("period", 20)
            handle_decls.pop()  # no handle needed for this one
            deinit_lines.pop()
            read_cur.append(f"int {iid}_hi_idx = iHighest(_Symbol, PERIOD_CURRENT, MODE_HIGH, {period}, 2);")
            read_cur.append(f"int {iid}_lo_idx = iLowest(_Symbol, PERIOD_CURRENT, MODE_LOW, {period}, 2);")
            read_cur.append(f"double {iid}_upper = iHigh(_Symbol, PERIOD_CURRENT, {iid}_hi_idx);")
            read_cur.append(f"double {iid}_lower = iLow(_Symbol, PERIOD_CURRENT, {iid}_lo_idx);")
            read_cur.append(f"double {iid}_middle = ({iid}_upper + {iid}_lower) / 2.0;")
            read_prev.append(f"int {iid}_hi_idx_prev = iHighest(_Symbol, PERIOD_CURRENT, MODE_HIGH, {period}, 3);")
            read_prev.append(f"int {iid}_lo_idx_prev = iLowest(_Symbol, PERIOD_CURRENT, MODE_LOW, {period}, 3);")
            read_prev.append(f"double {iid}_upper_prev = iHigh(_Symbol, PERIOD_CURRENT, {iid}_hi_idx_prev);")
            read_prev.append(f"double {iid}_lower_prev = iLow(_Symbol, PERIOD_CURRENT, {iid}_lo_idx_prev);")
            read_prev.append(f"double {iid}_middle_prev = ({iid}_upper_prev + {iid}_lower_prev) / 2.0;")
        elif t == "SUPERTREND":
            # No built-in MT5 indicator, and the recurrence is stateful
            # (each bar's band depends on the previous bar's band), so it's
            # recomputed from scratch each closed bar over a lookback window
            # using the same recurrence as indicators.py's supertrend().
            # This mirrors the Python reference exactly; only the ATR handle
            # is a persistent indicator handle, the rest is local arrays.
            period, mult = ind.get("period", 10), ind.get("mult", 3.0)
            lookback = max(150, period * 15)
            handle_decls[-1] = f"int {h};  // ATR handle backing Supertrend '{iid}'"
            init_lines.append(f'{h} = iATR(_Symbol, PERIOD_CURRENT, {period});')
            read_cur.append(_supertrend_block(iid, h, period, mult, lookback))
            read_prev.append(f"double {iid}_line_prev = {iid}_lineArr[1]; int {iid}_trend_prev = {iid}_trendArr[1];")
            read_cur.append(f"double {iid}_line = {iid}_lineArr[0]; int {iid}_trend = {iid}_trendArr[0];")

    return handle_decls, init_lines, read_cur, read_prev, deinit_lines


def _supertrend_block(iid, atr_handle, period, mult, lookback):
    """Emits the local-array recurrence that reproduces indicators.py's
    supertrend() over the last `lookback` closed bars, indexed as a
    series array (index 0 = last closed bar, matching CopyBuffer/CopyHigh
    series convention) so {iid}_lineArr[0]/[1] read like any other buffer."""
    n = lookback
    return f"""
   double {iid}_high[], {iid}_low[], {iid}_close[], {iid}_atr[];
   ArraySetAsSeries({iid}_high, true); ArraySetAsSeries({iid}_low, true);
   ArraySetAsSeries({iid}_close, true); ArraySetAsSeries({iid}_atr, true);
   if(CopyHigh(_Symbol, PERIOD_CURRENT, 1, {n}, {iid}_high) <= 0) return;
   if(CopyLow(_Symbol, PERIOD_CURRENT, 1, {n}, {iid}_low) <= 0) return;
   if(CopyClose(_Symbol, PERIOD_CURRENT, 1, {n}, {iid}_close) <= 0) return;
   if(CopyBuffer({atr_handle}, 0, 1, {n}, {iid}_atr) <= 0) return;
   // recurrence runs oldest->newest; series arrays are newest-first, so
   // walk index {n}-1 (oldest) down to 0 (last closed bar)
   double {iid}_finalUpper[], {iid}_finalLower[];
   double {iid}_lineArr[]; int {iid}_trendArr[];
   ArrayResize({iid}_finalUpper, {n}); ArrayResize({iid}_finalLower, {n});
   ArrayResize({iid}_lineArr, {n}); ArrayResize({iid}_trendArr, {n});
   for(int _i = {n}-1; _i >= 0; _i--)
     {{
      double hl2 = ({iid}_high[_i] + {iid}_low[_i]) / 2.0;
      double basicUpper = hl2 + {mult} * {iid}_atr[_i];
      double basicLower = hl2 - {mult} * {iid}_atr[_i];
      if(_i == {n}-1)
        {{
         {iid}_finalUpper[_i] = basicUpper; {iid}_finalLower[_i] = basicLower;
         {iid}_lineArr[_i] = basicUpper; {iid}_trendArr[_i] = 1;
         continue;
        }}
      double prevClose = {iid}_close[_i+1];
      {iid}_finalUpper[_i] = (basicUpper < {iid}_finalUpper[_i+1] || prevClose > {iid}_finalUpper[_i+1])
                              ? basicUpper : {iid}_finalUpper[_i+1];
      {iid}_finalLower[_i] = (basicLower > {iid}_finalLower[_i+1] || prevClose < {iid}_finalLower[_i+1])
                              ? basicLower : {iid}_finalLower[_i+1];
      double prevLine = {iid}_lineArr[_i+1];
      double curClose = {iid}_close[_i];
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


def _macd_signal_block_mql5(iid, handle, signal_period, lookback):
    """Recomputes the EMA-smoothed MACD signal line over `lookback` closed
    bars from the (correctly EMA-based) MACD-line buffer, since MetaTrader's
    own iMACD signal buffer is SMA-smoothed instead — see the MACD branch
    above. Seeding the oldest window bar with the raw MACD value itself
    matches pandas' ewm(adjust=False) behavior in indicators.py exactly."""
    n = lookback
    return f"""
   double {iid}_sigArr[];
   ArrayResize({iid}_sigArr, {n});
   double {iid}_alpha = 2.0 / ({signal_period} + 1.0);
   for(int _i = {n}-1; _i >= 0; _i--)
     {{
      int _shift = _i + 1;
      double _macdVal;
      if(!GetBufN({handle},0,_shift,_macdVal)) return;
      if(_i == {n}-1)
         {iid}_sigArr[_i] = _macdVal;
      else
         {iid}_sigArr[_i] = {iid}_alpha * _macdVal + (1.0 - {iid}_alpha) * {iid}_sigArr[_i+1];
     }}""".strip("\n")


def _cond_to_mql5(cond, suffix_cur="", suffix_prev="_prev"):
    left, op, right = cond["left"], cond["op"], cond["right"]
    lv, rv = _var_name(left), _var_name(right)
    if op in (">", "<", ">=", "<=", "=="):
        opsym = "==" if op == "==" else op
        return f"({lv} {opsym} {rv})"
    if op == "cross_above":
        return f"({lv}{suffix_prev} <= {rv}{suffix_prev} && {lv}{suffix_cur} > {rv}{suffix_cur})"
    if op == "cross_below":
        return f"({lv}{suffix_prev} >= {rv}{suffix_prev} && {lv}{suffix_cur} < {rv}{suffix_cur})"
    raise ValueError(op)


def generate_mql5(spec: dict) -> str:
    indicators = spec["indicators"]
    handle_decls, init_lines, read_cur, read_prev, deinit_lines = _handles_and_reads(indicators)

    long_conds = spec.get("entry_long", [])
    short_conds = spec.get("entry_short", [])
    long_expr = " && ".join(_cond_to_mql5(c) for c in long_conds) if long_conds else "false"
    short_expr = " && ".join(_cond_to_mql5(c) for c in short_conds) if short_conds else "false"

    risk = spec.get("risk", {})
    atr_id = risk.get("atr_id")
    sl_mode, tp_mode = risk.get("sl_mode", "ATR"), risk.get("tp_mode", "ATR")
    # "PIPS" mode's sl_points/tp_points is a raw price-unit distance (see
    # schema.py's docstring) — default 3.0/6.0 matches runner.py exactly so
    # a spec backtests and trades the same distance in every language.
    sl_expr = f"{atr_id} * {risk.get('sl_atr_mult', 2.0)}" if sl_mode == "ATR" else str(risk.get("sl_points", 3.0))
    tp_expr = f"{atr_id} * {risk.get('tp_atr_mult', 4.0)}" if tp_mode == "ATR" else str(risk.get("tp_points", 6.0))

    name = spec.get("name", "GeneratedStrategy").replace(" ", "")

    return f"""//+------------------------------------------------------------------+
//| {spec.get('name', 'Generated Strategy')} — AUTO-GENERATED from spec        |
//| Generated by the AT24 idea-to-code engine. Review before live use. |
//+------------------------------------------------------------------+
#property strict
input double InpRiskPercent = 1.0;
input int    InpMagic       = 900001;

{chr(10).join(handle_decls)}
datetime g_lastBarTime = 0;

bool GetBuf(int handle, int shift, double &value)
  {{
   double buf[]; ArraySetAsSeries(buf, true);
   if(CopyBuffer(handle, 0, shift, 1, buf) <= 0) return(false);
   value = buf[0]; return(true);
  }}
bool GetBufN(int handle, int bufIndex, int shift, double &value)
  {{
   double buf[]; ArraySetAsSeries(buf, true);
   if(CopyBuffer(handle, bufIndex, shift, 1, buf) <= 0) return(false);
   value = buf[0]; return(true);
  }}

int OnInit()
  {{
{chr(10).join('   ' + l for l in init_lines)}
   return(INIT_SUCCEEDED);
  }}

void OnDeinit(const int reason)
  {{
{chr(10).join('   ' + l for l in deinit_lines)}
  }}

bool HasOpenPosition()
  {{
   for(int i = PositionsTotal()-1; i >= 0; i--)
     {{
      ulong ticket = PositionGetTicket(i);
      if(ticket==0) continue;
      if(PositionGetString(POSITION_SYMBOL)==_Symbol && PositionGetInteger(POSITION_MAGIC)==InpMagic)
         return(true);
     }}
   return(false);
  }}

double CalcLots(double slDist)
  {{
   double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * (InpRiskPercent/100.0);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickSize<=0) tickSize=_Point;
   double lossPerLot = (slDist/tickSize)*tickValue;
   if(lossPerLot<=0) return(0);
   double lots = riskMoney/lossPerLot;
   double minLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN), step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   lots = MathFloor(lots/step)*step;
   return(MathMax(minLot, lots));
  }}

void OpenTrade(int direction, double slDist, double tpDist)
  {{
   double price = (direction>0) ? SymbolInfoDouble(_Symbol,SYMBOL_ASK) : SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double sl = price - direction*slDist;
   double tp = price + direction*tpDist;
   double lots = CalcLots(slDist);
   if(lots<=0) return;

   MqlTradeRequest req; MqlTradeResult res; ZeroMemory(req); ZeroMemory(res);
   req.action=TRADE_ACTION_DEAL; req.symbol=_Symbol; req.volume=lots;
   req.type=(direction>0)?ORDER_TYPE_BUY:ORDER_TYPE_SELL; req.price=price;
   req.sl=NormalizeDouble(sl,_Digits); req.tp=NormalizeDouble(tp,_Digits);
   req.deviation=20; req.magic=InpMagic; req.comment="{name}"; req.type_filling=ORDER_FILLING_IOC;
   OrderSend(req, res);
  }}

void OnTick()
  {{
   datetime curBarTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(curBarTime == g_lastBarTime) return;
   g_lastBarTime = curBarTime;
   if(HasOpenPosition()) return;

   double closeC = iClose(_Symbol, PERIOD_CURRENT, 1);
   double openC  = iOpen(_Symbol, PERIOD_CURRENT, 1);
   double highC  = iHigh(_Symbol, PERIOD_CURRENT, 1);
   double lowC   = iLow(_Symbol, PERIOD_CURRENT, 1);
   double closeC_prev = iClose(_Symbol, PERIOD_CURRENT, 2);
   double openC_prev  = iOpen(_Symbol, PERIOD_CURRENT, 2);
   double highC_prev  = iHigh(_Symbol, PERIOD_CURRENT, 2);
   double lowC_prev   = iLow(_Symbol, PERIOD_CURRENT, 2);

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
