//+------------------------------------------------------------------+
//| AT24_EA_Core.mqh                                                 |
//| Reusable execution-safety layer for AT24 Expert Advisors.        |
//|                                                                  |
//| Why: product EAs hardcoded one fill mode (e.g. M12 uses FOK) and |
//| treated CTrade::Buy() == false as the only failure signal. This  |
//| module centralises, per the MQL5 book (Part 6, Creating EAs):    |
//|   - fill-mode detection per symbol (SYMBOL_FILLING_MODE)         |
//|   - price / volume normalisation to tick size and lot step       |
//|   - spread, stops-level and freeze-level guards                  |
//|   - margin pre-check (OrderCalcMargin) and OrderCheck pre-flight |
//|   - retcode classification: retry / fatal / UNKNOWN-outcome      |
//|   - risk-based lot sizing via OrderCalcProfit                    |
//|                                                                  |
//| It never changes SL/TP silently: invalid stops are rejected with |
//| a reason and the caller decides. It never retries when the       |
//| outcome is unknown (timeout/connection), to avoid double orders. |
//+------------------------------------------------------------------+
#ifndef AT24_EA_CORE_MQH
#define AT24_EA_CORE_MQH

#define AT24_CORE_VERSION "0.1.0"

enum ENUM_AT24_EXEC_STATUS
  {
   AT24_EXEC_OK = 0,         // order accepted (DONE / PLACED / DONE_PARTIAL)
   AT24_EXEC_BLOCKED,        // stopped by our own pre-checks, nothing sent
   AT24_EXEC_REJECTED,       // server rejected with a definitive retcode
   AT24_EXEC_UNKNOWN         // outcome unknown (timeout/connection): reconcile positions, do NOT resend
  };

struct SAT24ExecConfig
  {
   ulong  magic;
   int    deviation_points;   // max slippage
   int    max_retries;        // for transient retcodes only
   int    retry_delay_ms;
   double max_spread_points;  // 0 = disabled
   double margin_buffer_pct;  // keep this % of free margin untouched (0-90)
   bool   use_ordercheck;     // run OrderCheck before every send
   bool   verbose;

   void Defaults()
     {
      magic = 0;
      deviation_points = 30;
      max_retries = 2;
      retry_delay_ms = 250;
      max_spread_points = 0.0;
      margin_buffer_pct = 20.0;
      use_ordercheck = true;
      verbose = true;
     }
  };

struct SAT24ExecResult
  {
   ENUM_AT24_EXEC_STATUS status;
   uint   retcode;            // 0 when blocked before sending
   string reason;
   ulong  ticket;             // order ticket (market deals: also position id source)
   double price;
   double volume;
   int    attempts;
  };

//+------------------------------------------------------------------+
//| Stateless helpers                                                |
//+------------------------------------------------------------------+
int AT24_VolumeDigits(const string sym)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   if(step <= 0.0)
      return 2;
   int d = 0;
   while(d < 8 && MathAbs(step * MathPow(10.0, d) - MathRound(step * MathPow(10.0, d))) > 1e-9)
      d++;
   return d;
  }

//--- Round DOWN to lot step; clamp to max; 0.0 if below min lot.
double AT24_NormalizeVolume(const string sym, const double volume)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0.0 || volume <= 0.0)
      return 0.0;
   double v = MathFloor(volume / step + 1e-9) * step;
   if(vmax > 0.0 && v > vmax)
      v = MathFloor(vmax / step + 1e-9) * step;
   if(v < vmin - 1e-12)
      return 0.0;
   return NormalizeDouble(v, AT24_VolumeDigits(sym));
  }

//--- Round to the symbol's tick size (not just digits).
double AT24_NormalizePrice(const string sym, const double price)
  {
   int    digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double ts     = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0.0)
      return NormalizeDouble(price, digits);
   return NormalizeDouble(MathRound(price / ts) * ts, digits);
  }

//--- Fill mode that the symbol actually allows. Prefers IOC (partial fills allowed)
//--- over FOK; falls back to RETURN.
ENUM_ORDER_TYPE_FILLING AT24_PickFilling(const string sym)
  {
   long flags = 0;
   if(!SymbolInfoInteger(sym, SYMBOL_FILLING_MODE, flags))
      return ORDER_FILLING_RETURN;
   if((flags & SYMBOL_FILLING_IOC) != 0)
      return ORDER_FILLING_IOC;
   if((flags & SYMBOL_FILLING_FOK) != 0)
      return ORDER_FILLING_FOK;
   return ORDER_FILLING_RETURN;
  }

double AT24_SpreadPoints(const string sym)
  {
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   if(point <= 0.0)
      return 0.0;
   return (SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID)) / point;
  }

//--- Validate SL/TP against the broker's stops level for a NEW position.
//--- sl/tp of 0 mean "not set". Never modifies the inputs.
bool AT24_StopsValid(const string sym, const ENUM_ORDER_TYPE type, const double price,
                     const double sl, const double tp, string &why)
  {
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   long   lvl   = SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = (double)lvl * point;
   bool   buy = (type == ORDER_TYPE_BUY);

   if(sl > 0.0)
     {
      if(buy ? (sl >= price) : (sl <= price))
        { why = "SL on wrong side of price"; return false; }
      if(MathAbs(price - sl) < minDist)
        { why = StringFormat("SL closer than stops level (%d pts)", (int)lvl); return false; }
     }
   if(tp > 0.0)
     {
      if(buy ? (tp <= price) : (tp >= price))
        { why = "TP on wrong side of price"; return false; }
      if(MathAbs(tp - price) < minDist)
        { why = StringFormat("TP closer than stops level (%d pts)", (int)lvl); return false; }
     }
   why = "";
   return true;
  }

//--- Lot size so that hitting SL loses riskPercent of equity. Uses OrderCalcProfit,
//--- which already handles cross-currency tick values. Returns 0.0 if it cannot size.
double AT24_LotForRisk(const string sym, const ENUM_ORDER_TYPE type, const double riskPercent,
                       const double entry, const double sl)
  {
   if(riskPercent <= 0.0 || entry <= 0.0 || sl <= 0.0 || entry == sl)
      return 0.0;
   double profitPerLot = 0.0;
   if(!OrderCalcProfit(type, sym, 1.0, entry, sl, profitPerLot))
      return 0.0;
   double lossPerLot = -profitPerLot;
   if(lossPerLot <= 0.0)
      return 0.0;
   double riskMoney = AccountInfoDouble(ACCOUNT_EQUITY) * riskPercent / 100.0;
   return AT24_NormalizeVolume(sym, riskMoney / lossPerLot);
  }

//--- Retcode classification.
bool AT24_RetcodeOK(const uint rc)
  {
   return rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL || rc == TRADE_RETCODE_PLACED;
  }

bool AT24_RetcodeTransient(const uint rc)
  {
   return rc == TRADE_RETCODE_REQUOTE || rc == TRADE_RETCODE_PRICE_CHANGED ||
          rc == TRADE_RETCODE_PRICE_OFF || rc == TRADE_RETCODE_TOO_MANY_REQUESTS ||
          rc == TRADE_RETCODE_REJECT;
  }

//--- Server may or may not have executed the request. Never blindly resend.
bool AT24_RetcodeUnknownOutcome(const uint rc)
  {
   return rc == TRADE_RETCODE_TIMEOUT || rc == TRADE_RETCODE_CONNECTION ||
          rc == TRADE_RETCODE_ERROR;
  }

//+------------------------------------------------------------------+
//| CAT24Exec: market open / close / SL-TP modify with full guards   |
//+------------------------------------------------------------------+
class CAT24Exec
  {
private:
   SAT24ExecConfig m_cfg;
   string          m_sym;

   void Log(const string msg) const
     {
      if(m_cfg.verbose)
         PrintFormat("[AT24-EXEC %s] %s", m_sym, msg);
     }

   void Fill(SAT24ExecResult &r, const ENUM_AT24_EXEC_STATUS st, const uint rc, const string why) const
     {
      r.status = st;
      r.retcode = rc;
      r.reason = why;
     }

   bool BuildDeal(MqlTradeRequest &req, const ENUM_ORDER_TYPE type, const double vol,
                  const double sl, const double tp, const string comment,
                  const ENUM_ORDER_TYPE_FILLING filling) const
     {
      MqlTick t;
      if(!SymbolInfoTick(m_sym, t))
         return false;
      ZeroMemory(req);
      req.action       = TRADE_ACTION_DEAL;
      req.symbol       = m_sym;
      req.volume       = vol;
      req.type         = type;
      req.price        = AT24_NormalizePrice(m_sym, (type == ORDER_TYPE_BUY) ? t.ask : t.bid);
      req.sl           = (sl > 0.0) ? AT24_NormalizePrice(m_sym, sl) : 0.0;
      req.tp           = (tp > 0.0) ? AT24_NormalizePrice(m_sym, tp) : 0.0;
      req.deviation    = (ulong)m_cfg.deviation_points;
      req.magic        = m_cfg.magic;
      req.comment      = comment;
      req.type_filling = filling;
      return true;
     }

   //--- send with retry; shared by Open and Close.
   void Send(MqlTradeRequest &req, SAT24ExecResult &r) const
     {
      ENUM_ORDER_TYPE_FILLING filling = req.type_filling;
      bool fillSwitched = false;
      for(int a = 1; a <= m_cfg.max_retries + 1; a++)
        {
         r.attempts = a;
         MqlTradeResult res;
         ZeroMemory(res);
         bool sent = OrderSend(req, res);
         r.retcode = res.retcode;
         r.ticket  = (res.order != 0) ? res.order : res.deal;
         r.price   = res.price;
         r.volume  = res.volume;

         if(AT24_RetcodeOK(res.retcode))
           { Fill(r, AT24_EXEC_OK, res.retcode, "ok"); return; }

         Log(StringFormat("attempt %d: retcode=%u (%s) sent=%s", a, res.retcode, res.comment, sent ? "true" : "false"));

         if(res.retcode == TRADE_RETCODE_INVALID_FILL && !fillSwitched)
           {
            //--- symbol/broker rejected our fill mode: try the other allowed ones once.
            long flags = SymbolInfoInteger(m_sym, SYMBOL_FILLING_MODE);
            ENUM_ORDER_TYPE_FILLING next = ORDER_FILLING_RETURN;
            if(filling != ORDER_FILLING_IOC && (flags & SYMBOL_FILLING_IOC) != 0)
               next = ORDER_FILLING_IOC;
            else if(filling != ORDER_FILLING_FOK && (flags & SYMBOL_FILLING_FOK) != 0)
               next = ORDER_FILLING_FOK;
            fillSwitched = true;
            if(next != filling)
              { filling = next; req.type_filling = next; continue; }
           }

         if(AT24_RetcodeUnknownOutcome(res.retcode))
           {
            Fill(r, AT24_EXEC_UNKNOWN, res.retcode, "outcome unknown - reconcile positions before resending: " + res.comment);
            return;
           }

         if(AT24_RetcodeTransient(res.retcode) && a <= m_cfg.max_retries)
           {
            Sleep(m_cfg.retry_delay_ms);
            MqlTick t;
            if(SymbolInfoTick(m_sym, t))
               req.price = AT24_NormalizePrice(m_sym, (req.type == ORDER_TYPE_BUY) ? t.ask : t.bid);
            continue;
           }

         Fill(r, AT24_EXEC_REJECTED, res.retcode, res.comment);
         return;
        }
     }

public:
   CAT24Exec() { m_cfg.Defaults(); m_sym = _Symbol; }

   void Init(const string sym, const SAT24ExecConfig &cfg)
     {
      m_sym = sym;
      m_cfg = cfg;
      SymbolSelect(m_sym, true);
     }

   string Symbol() const { return m_sym; }

   //--- Pre-flight only: everything Open() checks, but sends nothing.
   bool PreCheck(const ENUM_ORDER_TYPE type, const double volume, const double sl, const double tp,
                 SAT24ExecResult &r) const
     {
      ZeroMemory(r);
      if(type != ORDER_TYPE_BUY && type != ORDER_TYPE_SELL)
        { Fill(r, AT24_EXEC_BLOCKED, 0, "only market BUY/SELL supported"); return false; }
      if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "trading not allowed (terminal or EA algo-trading switch)"); return false; }
      if(!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) || !AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "account does not allow expert trading"); return false; }
      long mode = SymbolInfoInteger(m_sym, SYMBOL_TRADE_MODE);
      if(mode == SYMBOL_TRADE_MODE_DISABLED || mode == SYMBOL_TRADE_MODE_CLOSEONLY ||
         (type == ORDER_TYPE_BUY && mode == SYMBOL_TRADE_MODE_SHORTONLY) ||
         (type == ORDER_TYPE_SELL && mode == SYMBOL_TRADE_MODE_LONGONLY))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "symbol trade mode does not allow this direction"); return false; }

      double vol = AT24_NormalizeVolume(m_sym, volume);
      if(vol <= 0.0)
        { Fill(r, AT24_EXEC_BLOCKED, 0, StringFormat("volume %.4f invalid (below min lot or bad step)", volume)); return false; }

      if(m_cfg.max_spread_points > 0.0)
        {
         double sp = AT24_SpreadPoints(m_sym);
         if(sp > m_cfg.max_spread_points)
           { Fill(r, AT24_EXEC_BLOCKED, 0, StringFormat("spread %.0f > max %.0f pts", sp, m_cfg.max_spread_points)); return false; }
        }

      MqlTick t;
      if(!SymbolInfoTick(m_sym, t) || t.ask <= 0.0 || t.bid <= 0.0)
        { Fill(r, AT24_EXEC_BLOCKED, 0, "no valid tick"); return false; }
      double px = (type == ORDER_TYPE_BUY) ? t.ask : t.bid;

      string why;
      if(!AT24_StopsValid(m_sym, type, px, sl, tp, why))
        { Fill(r, AT24_EXEC_BLOCKED, 0, why); return false; }

      double margin = 0.0;
      if(!OrderCalcMargin(type, m_sym, vol, px, margin))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "OrderCalcMargin failed"); return false; }
      double freeMargin = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
      double usable = freeMargin * (1.0 - m_cfg.margin_buffer_pct / 100.0);
      if(margin > usable)
        { Fill(r, AT24_EXEC_BLOCKED, 0, StringFormat("margin %.2f > usable free margin %.2f", margin, usable)); return false; }

      if(m_cfg.use_ordercheck)
        {
         MqlTradeRequest req;
         if(!BuildDeal(req, type, vol, sl, tp, "", AT24_PickFilling(m_sym)))
           { Fill(r, AT24_EXEC_BLOCKED, 0, "could not build request"); return false; }
         MqlTradeCheckResult chk;
         ZeroMemory(chk);
         if(!OrderCheck(req, chk))
           { Fill(r, AT24_EXEC_BLOCKED, chk.retcode, "OrderCheck failed: " + chk.comment); return false; }
        }

      r.status = AT24_EXEC_OK;
      r.reason = "precheck ok";
      r.volume = vol;
      r.price  = px;
      return true;
     }

   //--- Market BUY/SELL with all guards. Returns true only on accepted order.
   bool Open(const ENUM_ORDER_TYPE type, const double volume, const double sl, const double tp,
             const string comment, SAT24ExecResult &r)
     {
      if(!PreCheck(type, volume, sl, tp, r))
        { Log("blocked: " + r.reason); return false; }
      MqlTradeRequest req;
      double vol = AT24_NormalizeVolume(m_sym, volume);
      if(!BuildDeal(req, type, vol, sl, tp, comment, AT24_PickFilling(m_sym)))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "could not build request"); return false; }
      Send(req, r);
      Log(StringFormat("open %s vol=%.2f -> status=%d retcode=%u %s", EnumToString(type), vol, (int)r.status, r.retcode, r.reason));
      return r.status == AT24_EXEC_OK;
     }

   //--- Close a position fully (volume<=0) or partially.
   bool Close(const ulong positionTicket, const double volume, SAT24ExecResult &r)
     {
      ZeroMemory(r);
      if(!PositionSelectByTicket(positionTicket))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "position not found"); return false; }
      string sym = PositionGetString(POSITION_SYMBOL);
      if(sym != m_sym)
        { Fill(r, AT24_EXEC_BLOCKED, 0, "position symbol differs from executor symbol"); return false; }
      double posVol = PositionGetDouble(POSITION_VOLUME);
      double vol = (volume <= 0.0 || volume > posVol) ? posVol : AT24_NormalizeVolume(m_sym, volume);
      if(vol <= 0.0)
        { Fill(r, AT24_EXEC_BLOCKED, 0, "close volume invalid"); return false; }
      ENUM_ORDER_TYPE closeType = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
      MqlTradeRequest req;
      if(!BuildDeal(req, closeType, vol, 0.0, 0.0, "close", AT24_PickFilling(m_sym)))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "could not build request"); return false; }
      req.position = positionTicket;
      Send(req, r);
      Log(StringFormat("close #%I64u vol=%.2f -> status=%d retcode=%u %s", positionTicket, vol, (int)r.status, r.retcode, r.reason));
      return r.status == AT24_EXEC_OK;
     }

   //--- Modify SL/TP; skips (as no-op success) when unchanged, blocks inside the freeze level.
   bool ModifySLTP(const ulong positionTicket, const double sl, const double tp, SAT24ExecResult &r)
     {
      ZeroMemory(r);
      if(!PositionSelectByTicket(positionTicket))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "position not found"); return false; }
      double nsl = (sl > 0.0) ? AT24_NormalizePrice(m_sym, sl) : 0.0;
      double ntp = (tp > 0.0) ? AT24_NormalizePrice(m_sym, tp) : 0.0;
      double csl = PositionGetDouble(POSITION_SL), ctp = PositionGetDouble(POSITION_TP);
      double eps = SymbolInfoDouble(m_sym, SYMBOL_POINT) / 2.0;
      if(MathAbs(nsl - csl) < eps && MathAbs(ntp - ctp) < eps)
        { Fill(r, AT24_EXEC_OK, 0, "unchanged (no-op)"); return true; }

      double point = SymbolInfoDouble(m_sym, SYMBOL_POINT);
      double freeze = (double)SymbolInfoInteger(m_sym, SYMBOL_TRADE_FREEZE_LEVEL) * point;
      bool isBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double mkt = isBuy ? SymbolInfoDouble(m_sym, SYMBOL_BID) : SymbolInfoDouble(m_sym, SYMBOL_ASK);
      if(freeze > 0.0 && ((csl > 0.0 && MathAbs(mkt - csl) <= freeze) || (ctp > 0.0 && MathAbs(mkt - ctp) <= freeze)))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "price inside freeze level of current SL/TP"); return false; }

      double stopsMin = (double)SymbolInfoInteger(m_sym, SYMBOL_TRADE_STOPS_LEVEL) * point;
      if(nsl > 0.0 && (isBuy ? (mkt - nsl) < stopsMin : (nsl - mkt) < stopsMin))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "new SL violates stops level"); return false; }
      if(ntp > 0.0 && (isBuy ? (ntp - mkt) < stopsMin : (mkt - ntp) < stopsMin))
        { Fill(r, AT24_EXEC_BLOCKED, 0, "new TP violates stops level"); return false; }

      MqlTradeRequest req;
      ZeroMemory(req);
      req.action   = TRADE_ACTION_SLTP;
      req.symbol   = m_sym;
      req.position = positionTicket;
      req.sl       = nsl;
      req.tp       = ntp;
      req.magic    = m_cfg.magic;
      MqlTradeResult res;
      ZeroMemory(res);
      bool sent = OrderSend(req, res);
      r.retcode = res.retcode;
      if(sent && AT24_RetcodeOK(res.retcode))
        { Fill(r, AT24_EXEC_OK, res.retcode, "ok"); return true; }
      if(AT24_RetcodeUnknownOutcome(res.retcode))
         Fill(r, AT24_EXEC_UNKNOWN, res.retcode, "outcome unknown: " + res.comment);
      else
         Fill(r, AT24_EXEC_REJECTED, res.retcode, res.comment);
      Log(StringFormat("modify #%I64u -> retcode=%u %s", positionTicket, res.retcode, res.comment));
      return false;
     }
  };

#endif // AT24_EA_CORE_MQH
