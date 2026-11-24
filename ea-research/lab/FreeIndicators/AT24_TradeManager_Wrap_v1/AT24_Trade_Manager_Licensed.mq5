//+------------------------------------------------------------------+
//| AT24 Trade Manager - risk based order panel, trade management    |
//| and account loss lock. Places no trades by itself.               |
//+------------------------------------------------------------------+
#property copyright "Algotraders24 AI"
#property version   "1.00"
#property description "Risk based order panel with break-even, trailing, partial close and a daily loss / drawdown lock."
#property description "Places orders only when you press a button. Not financial advice."
#property strict

#define AT24_PRODUCT_ID "AT24-TRADE-MANAGER"
#include "AT24_LicenseGate.mqh"
#include <Trade/Trade.mqh>

input string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)

enum ENUM_AT24_RISK  { RISK_PCT_BALANCE = 0, RISK_PCT_EQUITY = 1, RISK_MONEY = 2 };
enum ENUM_AT24_TRAIL { TRAIL_OFF = 0, TRAIL_POINTS = 1, TRAIL_ATR = 2, TRAIL_CANDLES = 3 };
enum ENUM_AT24_SCOPE { SCOPE_SYMBOL = 0, SCOPE_PANEL = 1 };

input group "Risk per trade"
input ENUM_AT24_RISK InpRiskMode      = RISK_PCT_BALANCE; // Risk is measured as
input double         InpRiskPct       = 1.0;              // Risk in percent (percent modes)
input double         InpRiskMoney     = 50.0;             // Risk in account currency (money mode)
input group "Order"
input long           InpMagic         = 240117;           // Magic number of panel orders
input int            InpDeviation     = 20;               // Max slippage (points)
input double         InpMaxSpreadPct  = 15.0;             // Warn when spread is above this % of the stop distance
input group "Management"
input ENUM_AT24_SCOPE InpScope        = SCOPE_SYMBOL;     // Manage: all positions of this symbol / panel orders only
input bool           InpAutoBE        = false;            // Break-even on at start
input double         InpBEAtR         = 1.0;              // Break-even when profit reaches this many R
input int            InpBEOffsetPts   = 10;               // Break-even offset (points)
input bool           InpAutoPartial   = false;            // Partial close on at start
input double         InpPartialAtR    = 1.0;              // Partial close when profit reaches this many R
input double         InpPartialPct    = 50.0;             // Percent of the position to close
input ENUM_AT24_TRAIL InpTrailMode    = TRAIL_OFF;        // Trailing stop mode
input double         InpTrailStartR   = 1.0;              // Trailing starts at this many R
input int            InpTrailPoints   = 300;              // Trail distance (points mode)
input double         InpTrailATRMult  = 2.0;              // Trail distance in ATR (ATR mode)
input int            InpTrailCandles  = 5;                // Number of closed candles (candles mode)
input group "Account lock"
input double         InpDailyLossPct  = 0.0;              // Daily loss limit in percent (0 = off)
input double         InpMaxDDPct      = 0.0;              // Drawdown limit from peak equity in percent (0 = off)
input bool           InpCloseOnBreach = true;             // On a breach close all positions and delete pending orders
input bool           InpAlerts        = true;             // Alert and push message on a breach
input group "Panel"
input int            InpPanelX        = 10;               // Panel X
input int            InpPanelY        = 24;               // Panel Y

#define PFX "AT24TM_"
CTrade   trade;
int      hATR = INVALID_HANDLE;
double   gRiskPct;
bool     gAutoBE, gAutoPartial, gTrailOn;
bool     gDayLock = false, gDDLock = false;
double   gDayBal = 0, gPeak = 0, gEquityNow = 0;
datetime gDay = 0;
string   gMsg = "";
datetime gMsgTime = 0;
datetime gLastClean = 0;

string GKey(const string s) { return PFX + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + s; }
void   GSet(const string s, const double v) { GlobalVariableSet(GKey(s), v); }
double GGet(const string s, const double def) { return GlobalVariableCheck(GKey(s)) ? GlobalVariableGet(GKey(s)) : def; }
void   Say(const string m) { gMsg = m; gMsgTime = TimeCurrent(); }

//+------------------------------------------------------------------+
//| Panel                                                            |
//+------------------------------------------------------------------+
#define PW 280
color C_BG = C'10,22,40', C_BORDER = C'240,180,41', C_TXT = C'200,210,220', C_DIM = C'120,135,150';

void MkRect(const string n, int x, int y, int w, int h, color bg, color border)
  {
   if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, InpPanelX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, InpPanelY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, border);
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_ZORDER, 0);
  }

void MkLabel(const string n, int x, int y, const string txt, color c, int size = 9)
  {
   if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, InpPanelX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, InpPanelY + y);
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
   ObjectSetString(0, n, OBJPROP_FONT, "Segoe UI");
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_ZORDER, 1);
  }

void MkBtn(const string n, int x, int y, int w, int h, const string txt, color bg)
  {
   if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, InpPanelX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, InpPanelY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetString(0, n, OBJPROP_TEXT, txt);
   ObjectSetString(0, n, OBJPROP_FONT, "Segoe UI");
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, 9);
   ObjectSetInteger(0, n, OBJPROP_COLOR, clrWhite);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_BORDER_COLOR, C_BORDER);
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_ZORDER, 2);
   ObjectSetInteger(0, n, OBJPROP_STATE, false);
  }

void BuildPanel()
  {
   MkRect(PFX + "bg", 0, 0, PW, 312, C_BG, C_BORDER);
   MkLabel(PFX + "t0", 10, 6, "AT24 TRADE MANAGER", C_BORDER, 10);
   for(int i = 0; i < 8; i++) MkLabel(PFX + "l" + IntegerToString(i), 10, 28 + i * 17, "", C_TXT);
   MkBtn(PFX + "b_buy",   10, 168, 128, 28, "BUY",  C'25,120,100');
   MkBtn(PFX + "b_sell", 142, 168, 128, 28, "SELL", C'170,60,65');
   MkBtn(PFX + "b_rm",    10, 200,  60, 22, "RISK -", C'40,55,75');
   MkBtn(PFX + "b_rp",    74, 200,  60, 22, "RISK +", C'40,55,75');
   MkBtn(PFX + "b_flip", 142, 200, 128, 22, "FLIP LINES", C'40,55,75');
   MkBtn(PFX + "b_be",    10, 226, 128, 22, "BREAK-EVEN NOW", C'40,55,75');
   MkBtn(PFX + "b_half", 142, 226, 128, 22, "CLOSE HALF", C'40,55,75');
   MkBtn(PFX + "b_all",   10, 252, 128, 22, "CLOSE ALL", C'120,50,55');
   MkBtn(PFX + "b_peak", 142, 252, 128, 22, "RESET PEAK", C'40,55,75');
   MkBtn(PFX + "b_abe",   10, 278,  60, 22, "", C'40,55,75');
   MkBtn(PFX + "b_apt",   74, 278,  60, 22, "", C'40,55,75');
   MkBtn(PFX + "b_atr",  142, 278, 128, 22, "", C'40,55,75');
  }

void Txt(const int i, const string s, color c = C'200,210,220')
  {
   ObjectSetString(0, PFX + "l" + IntegerToString(i), OBJPROP_TEXT, s);
   ObjectSetInteger(0, PFX + "l" + IntegerToString(i), OBJPROP_COLOR, c);
  }

//+------------------------------------------------------------------+
//| Lines                                                            |
//+------------------------------------------------------------------+
double AtrNow()
  {
   if(hATR == INVALID_HANDLE) return 0;
   double b[1];
   if(CopyBuffer(hATR, 0, 1, 1, b) != 1) return 0;
   return b[0];
  }

void MkLine(const string n, double price, color c)
  {
   if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_HLINE, 0, 0, price);
   ObjectSetDouble(0, n, OBJPROP_PRICE, price);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_STYLE, STYLE_DASH);
   ObjectSetInteger(0, n, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, true);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, false);
  }

void DefaultLines()
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double atr = AtrNow();
   if(atr <= 0) atr = 200 * _Point;
   MkLine(PFX + "SL", NormalizeDouble(bid - 1.5 * atr, _Digits), C'230,90,90');
   MkLine(PFX + "TP", NormalizeDouble(bid + 3.0 * atr, _Digits), C'45,200,180');
  }

double LinePrice(const string n)
  {
   if(ObjectFind(0, n) < 0) return 0;
   return ObjectGetDouble(0, n, OBJPROP_PRICE);
  }

//+------------------------------------------------------------------+
//| Plan: lot from risk and the SL line                              |
//+------------------------------------------------------------------+
double RiskMoney()
  {
   if(InpRiskMode == RISK_MONEY) return InpRiskMoney * gRiskPct / MathMax(InpRiskPct, 0.0001);
   double base = (InpRiskMode == RISK_PCT_EQUITY) ? AccountInfoDouble(ACCOUNT_EQUITY) : AccountInfoDouble(ACCOUNT_BALANCE);
   return base * gRiskPct / 100.0;
  }

bool Plan(const int dir, double &lots, double &entry, double &sl, double &tp, string &err)
  {
   err = ""; lots = 0;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(ask <= 0 || bid <= 0) { err = "No price"; return false; }
   entry = (dir > 0) ? ask : bid;
   sl = LinePrice(PFX + "SL"); tp = LinePrice(PFX + "TP");
   if(sl <= 0) { err = "SL line missing (press FLIP LINES)"; return false; }
   if(dir > 0 && sl >= entry) { err = "BUY: move the SL line below price"; return false; }
   if(dir < 0 && sl <= entry) { err = "SELL: move the SL line above price"; return false; }
   if(tp > 0 && ((dir > 0 && tp <= entry) || (dir < 0 && tp >= entry))) { err = "TP line is on the wrong side"; return false; }
   double dist = MathAbs(entry - sl);
   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   if(dist < minDist) { err = "SL too close (broker minimum)"; return false; }
   double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickVal <= 0) tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0 || tickVal <= 0) { err = "No tick value"; return false; }
   double lossPerLot = dist / tickSize * tickVal;
   double risk = RiskMoney();
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = vmin;
   double raw = risk / lossPerLot;
   lots = MathFloor(raw / step + 1e-9) * step;
   lots = NormalizeDouble(lots, 8);
   if(lots < vmin) { err = StringFormat("Risk too small: min lot %.2f risks %.2f", vmin, vmin * lossPerLot); lots = 0; return false; }
   if(lots > vmax) lots = vmax;
   double margin = 0;
   if(OrderCalcMargin(dir > 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, lots, entry, margin))
      if(margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.95) { err = "Not enough free margin"; return false; }
   return true;
  }

//+------------------------------------------------------------------+
//| Account lock                                                     |
//+------------------------------------------------------------------+
double ClosedToday()
  {
   double sum = 0;
   if(!HistorySelect(gDay, TimeCurrent() + 60)) return 0;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      long ty = HistoryDealGetInteger(t, DEAL_TYPE);
      if(ty != DEAL_TYPE_BUY && ty != DEAL_TYPE_SELL) continue;
      sum += HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_COMMISSION) + HistoryDealGetDouble(t, DEAL_SWAP) + HistoryDealGetDouble(t, DEAL_FEE);
     }
   return sum;
  }

void DayRoll()
  {
   datetime today = (datetime)((long)TimeCurrent() / 86400 * 86400);
   if(today != gDay)
     {
      gDay = today;
      gDayBal = AccountInfoDouble(ACCOUNT_BALANCE) - ClosedToday();
      gDayLock = false;
      GSet("day", (double)gDay); GSet("daybal", gDayBal);
     }
  }

void CloseEverything()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t > 0) trade.PositionClose(t, InpDeviation);
     }
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t > 0) trade.OrderDelete(t);
     }
  }

void CheckLock()
  {
   DayRoll();
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   gEquityNow = eq;
   if(eq > gPeak) { gPeak = eq; GSet("peak", gPeak); }
   bool wasLocked = gDayLock || gDDLock;
   if(InpDailyLossPct > 0 && gDayBal > 0 && (gDayBal - eq) / gDayBal * 100.0 >= InpDailyLossPct) gDayLock = true;
   if(InpMaxDDPct > 0 && gPeak > 0 && (gPeak - eq) / gPeak * 100.0 >= InpMaxDDPct) { gDDLock = true; GSet("ddlock", 1); }
   bool locked = gDayLock || gDDLock;
   if(locked && !wasLocked)
     {
      string m = gDDLock ? "AT24 Trade Manager: drawdown limit reached, account locked" : "AT24 Trade Manager: daily loss limit reached, trading locked until next server day";
      Print(m);
      if(InpAlerts) { Alert(m); SendNotification(m); }
      Say("LOCK: limit reached");
     }
   if(locked && InpCloseOnBreach && (PositionsTotal() > 0 || OrdersTotal() > 0)) CloseEverything();
  }

//+------------------------------------------------------------------+
//| Position management                                              |
//+------------------------------------------------------------------+
bool InScope()
  {
   if(PositionGetString(POSITION_SYMBOL) != _Symbol) return false;
   if(InpScope == SCOPE_PANEL && PositionGetInteger(POSITION_MAGIC) != InpMagic) return false;
   return true;
  }

bool MoveSL(const ulong ticket, const double newSL)
  {
   if(!PositionSelectByTicket(ticket)) return false;
   long ty = PositionGetInteger(POSITION_TYPE);
   double cur = PositionGetDouble(POSITION_SL), tp = PositionGetDouble(POSITION_TP);
   double lvl = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID), ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double nsl = NormalizeDouble(newSL, _Digits);
   if(ty == POSITION_TYPE_BUY)
     { if(nsl <= cur && cur > 0) return false; if(nsl > bid - lvl) return false; }
   else
     { if(cur > 0 && nsl >= cur) return false; if(nsl < ask + lvl) return false; }
   return trade.PositionModify(ticket, nsl, tp);
  }

void ManageOne(const ulong ticket)
  {
   if(!PositionSelectByTicket(ticket)) return;
   long ty = PositionGetInteger(POSITION_TYPE);
   double open = PositionGetDouble(POSITION_PRICE_OPEN), sl = PositionGetDouble(POSITION_SL);
   double vol = PositionGetDouble(POSITION_VOLUME);
   double px = (ty == POSITION_TYPE_BUY) ? SymbolInfoDouble(_Symbol, SYMBOL_BID) : SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double profit = (ty == POSITION_TYPE_BUY) ? px - open : open - px;
   string rk = "R_" + IntegerToString((long)ticket);
   double R = GGet(rk, 0);
   if(R <= 0)
     {
      R = (sl > 0) ? MathAbs(open - sl) : AtrNow();
      if(R > 0) GSet(rk, R);
     }
   if(R <= 0) return;
   double pt = _Point;
   // partial close
   if(gAutoPartial && profit >= InpPartialAtR * R && GGet("P_" + IntegerToString((long)ticket), 0) == 0)
     {
      double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      double cv = MathFloor(vol * InpPartialPct / 100.0 / step + 1e-9) * step;
      if(cv >= vmin && vol - cv >= vmin)
        { if(trade.PositionClosePartial(ticket, cv, InpDeviation)) { GSet("P_" + IntegerToString((long)ticket), 1); Say("Partial close done"); } }
      else GSet("P_" + IntegerToString((long)ticket), 1);
      if(!PositionSelectByTicket(ticket)) return;
      sl = PositionGetDouble(POSITION_SL);
     }
   // break-even
   if(gAutoBE && profit >= InpBEAtR * R)
     {
      double be = (ty == POSITION_TYPE_BUY) ? open + InpBEOffsetPts * pt : open - InpBEOffsetPts * pt;
      MoveSL(ticket, be);
     }
   // trailing
   if(gTrailOn && InpTrailMode != TRAIL_OFF && profit >= InpTrailStartR * R)
     {
      double cand = 0;
      if(InpTrailMode == TRAIL_POINTS) cand = (ty == POSITION_TYPE_BUY) ? px - InpTrailPoints * pt : px + InpTrailPoints * pt;
      else if(InpTrailMode == TRAIL_ATR)
        { double a = AtrNow(); if(a > 0) cand = (ty == POSITION_TYPE_BUY) ? px - InpTrailATRMult * a : px + InpTrailATRMult * a; }
      else if(InpTrailMode == TRAIL_CANDLES)
        {
         int n = MathMax(1, InpTrailCandles);
         if(ty == POSITION_TYPE_BUY) { double v = DBL_MAX; for(int i = 1; i <= n; i++) v = MathMin(v, iLow(_Symbol, _Period, i)); if(v < DBL_MAX) cand = v - pt; }
         else { double v = 0; for(int i = 1; i <= n; i++) v = MathMax(v, iHigh(_Symbol, _Period, i)); if(v > 0) cand = v + pt; }
        }
      if(cand > 0) MoveSL(ticket, cand);
     }
  }

void ManageAll()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !InScope()) continue;
      ManageOne(t);
     }
  }

void CleanGlobals()
  {
   datetime now = TimeCurrent();
   if(now - gLastClean < 3600) return;
   gLastClean = now;
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
     {
      string nm = GlobalVariableName(i);
      if(StringFind(nm, GKey("R_")) != 0 && StringFind(nm, GKey("P_")) != 0) continue;
      string tk = StringSubstr(nm, StringLen(GKey("R_")));
      if(!PositionSelectByTicket((ulong)StringToInteger(tk))) GlobalVariableDel(nm);
     }
  }

void ScopeAction(const int what) // 1 = break-even now, 2 = close half, 3 = close all in scope
  {
   int done = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !InScope()) continue;
      long ty = PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN), vol = PositionGetDouble(POSITION_VOLUME);
      if(what == 1)
        { if(MoveSL(t, ty == POSITION_TYPE_BUY ? open + InpBEOffsetPts * _Point : open - InpBEOffsetPts * _Point)) done++; }
      else if(what == 2)
        {
         double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP), vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
         double cv = MathFloor(vol / 2.0 / step + 1e-9) * step;
         if(cv >= vmin && vol - cv >= vmin && trade.PositionClosePartial(t, cv, InpDeviation)) done++;
        }
      else if(what == 3) { if(trade.PositionClose(t, InpDeviation)) done++; }
     }
   Say(done > 0 ? StringFormat("Done on %d position(s)", done) : "Nothing to do");
  }

//+------------------------------------------------------------------+
//| Orders                                                           |
//+------------------------------------------------------------------+
void Send(const int dir)
  {
   if(!AT24Gate_Allowed()) { Say("Licence check failed: no new orders"); return; }
   if(gDayLock || gDDLock) { Say("Locked: no new orders"); return; }
   double lots, entry, sl, tp; string err;
   if(!Plan(dir, lots, entry, sl, tp, err)) { Say(err); return; }
   bool ok = (dir > 0) ? trade.Buy(lots, _Symbol, 0, sl, tp, "AT24 TM") : trade.Sell(lots, _Symbol, 0, sl, tp, "AT24 TM");
   if(ok && (trade.ResultRetcode() == TRADE_RETCODE_DONE || trade.ResultRetcode() == TRADE_RETCODE_PLACED))
      Say(StringFormat("%s %.2f lots sent", dir > 0 ? "BUY" : "SELL", lots));
   else Say("Order rejected: " + trade.ResultRetcodeDescription());
  }

//+------------------------------------------------------------------+
//| Display                                                          |
//+------------------------------------------------------------------+
void Refresh()
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID), ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double sl = LinePrice(PFX + "SL"), tp = LinePrice(PFX + "TP");
   double spread = (ask - bid) / _Point;
   Txt(0, StringFormat("%s   spread %.0f pts", _Symbol, spread));
   Txt(1, StringFormat("Risk %.2f%s = %.2f %s", gRiskPct, InpRiskMode == RISK_MONEY ? "x" : "%", RiskMoney(), AccountInfoString(ACCOUNT_CURRENCY)));
   // plan preview for the side the lines suggest
   int dir = (sl > 0 && sl < bid) ? 1 : -1;
   double lots, entry, psl, ptp; string err;
   bool ok = Plan(dir, lots, entry, psl, ptp, err);
   if(sl <= 0) Txt(2, "Lines missing: press FLIP LINES", clrOrange);
   else
     {
      double dist = MathAbs((dir > 0 ? ask : bid) - sl) / _Point;
      string rr = "";
      if(tp > 0) rr = StringFormat("  RR %.2f", MathAbs(tp - (dir > 0 ? ask : bid)) / MathMax(MathAbs((dir > 0 ? ask : bid) - sl), _Point));
      Txt(2, StringFormat("%s plan: SL %.0f pts%s", dir > 0 ? "BUY" : "SELL", dist, rr));
      if(ok) Txt(3, StringFormat("Lots %.2f", lots), clrWhite);
      else Txt(3, err, clrOrange);
      if(dist > 0 && spread / dist * 100.0 > InpMaxSpreadPct) Txt(4, StringFormat("Warning: spread is %.0f%% of the stop", spread / dist * 100.0), clrOrange);
      else Txt(4, "Spread check ok", C_DIM);
     }
   double dayPL = (gDayBal > 0) ? (gEquityNow - gDayBal) / gDayBal * 100.0 : 0;
   double dd = (gPeak > 0) ? (gPeak - gEquityNow) / gPeak * 100.0 : 0;
   Txt(5, StringFormat("Today %+.2f%%" + (InpDailyLossPct > 0 ? "  (limit -%.1f%%)" : ""), dayPL, InpDailyLossPct), dayPL < 0 ? C'230,90,90' : C_TXT);
   Txt(6, StringFormat("Drawdown %.2f%%" + (InpMaxDDPct > 0 ? "  (limit %.1f%%)" : ""), dd, InpMaxDDPct));
   string st = gDDLock ? "LOCKED: drawdown limit (RESET PEAK)" : (gDayLock ? "LOCKED until next server day" : "Unlocked");
   if(gMsg != "" && TimeCurrent() - gMsgTime < 10) st = gMsg;
   Txt(7, st, (gDayLock || gDDLock) ? C'230,90,90' : C_BORDER);
   ObjectSetString(0, PFX + "b_abe", OBJPROP_TEXT, gAutoBE ? "BE: ON" : "BE: off");
   ObjectSetString(0, PFX + "b_apt", OBJPROP_TEXT, gAutoPartial ? "PART: ON" : "PART: off");
   ObjectSetString(0, PFX + "b_atr", OBJPROP_TEXT, gTrailOn ? "TRAIL: ON" : "TRAIL: off");
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey))
      return INIT_FAILED;
   gRiskPct = (InpRiskMode == RISK_MONEY) ? InpRiskPct : InpRiskPct;
   if(gRiskPct <= 0) gRiskPct = 1.0;
   gAutoBE = InpAutoBE; gAutoPartial = InpAutoPartial; gTrailOn = (InpTrailMode != TRAIL_OFF);
   trade.SetExpertMagicNumber((ulong)InpMagic);
   trade.SetDeviationInPoints(InpDeviation);
   trade.SetTypeFillingBySymbol(_Symbol);
   hATR = iATR(_Symbol, _Period, 14);
   gPeak = GGet("peak", AccountInfoDouble(ACCOUNT_EQUITY));
   gDDLock = (GGet("ddlock", 0) == 1);
   gDay = (datetime)(long)GGet("day", 0);
   gDayBal = GGet("daybal", 0);
   gEquityNow = AccountInfoDouble(ACCOUNT_EQUITY);
   DayRoll();
   if(gDayBal <= 0) gDayBal = AccountInfoDouble(ACCOUNT_BALANCE);
   BuildPanel();
   DefaultLines();
   EventSetTimer(1);
   Refresh();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0, PFX);
   if(hATR != INVALID_HANDLE) IndicatorRelease(hATR);
  }

#ifdef AT24_SELFTEST
int gST=0;
void SelfTest()
  {
   gST++;
   if(gST%1500==3 && PositionsTotal()==0 && !gDayLock && !gDDLock) { Send(1); Print("ST send buy: ", gMsg); }
   if(gST%400==0)
     {
      string s="ST tick "+IntegerToString(gST)+" pos="+IntegerToString(PositionsTotal())+" daylock="+IntegerToString(gDayLock)+" msg="+gMsg;
      if(PositionsTotal()>0 && PositionGetTicket(0)>0) s+=StringFormat(" vol=%.2f open=%.5f sl=%.5f tp=%.5f",PositionGetDouble(POSITION_VOLUME),PositionGetDouble(POSITION_PRICE_OPEN),PositionGetDouble(POSITION_SL),PositionGetDouble(POSITION_TP));
      Print(s);
     }
  }
#endif

void Cycle()
  {
   CheckLock();
   ManageAll();
   CleanGlobals();
#ifdef AT24_SELFTEST
   SelfTest();
#endif
   Refresh();
  }

void OnTick() { Cycle(); }
#ifdef AT24_SHOT
int gShotN = 0;
void ShotCycle()
  {
   gShotN++;
   if(gShotN == 15)
     {
      ChartSetInteger(0, CHART_SHOW_TRADE_HISTORY, false); ChartSetInteger(0, CHART_MODE, CHART_CANDLES); ChartSetInteger(0, CHART_SCALE, 4);
      ChartSetInteger(0, CHART_SHOW_GRID, false); ChartSetInteger(0, CHART_SHOW_VOLUMES, CHART_VOLUME_HIDE); ChartSetInteger(0, CHART_SHOW_ASK_LINE, false);
      ChartSetInteger(0, CHART_SHOW_PERIOD_SEP, false); ChartSetInteger(0, CHART_SHIFT, true); ChartSetDouble(0, CHART_SHIFT_SIZE, 20.0);
      ChartSetInteger(0, CHART_COLOR_BACKGROUND, C'10,22,40'); ChartSetInteger(0, CHART_COLOR_FOREGROUND, C'200,210,220');
      ChartSetInteger(0, CHART_COLOR_CANDLE_BULL, C'45,200,180'); ChartSetInteger(0, CHART_COLOR_CANDLE_BEAR, C'230,90,90');
      ChartSetInteger(0, CHART_COLOR_CHART_UP, C'45,200,180'); ChartSetInteger(0, CHART_COLOR_CHART_DOWN, C'230,90,90'); ChartSetInteger(0, CHART_COLOR_CHART_LINE, C'200,210,220');
      ChartRedraw(0);
     }
   if(gShotN == 18)
     {
      ChartScreenShot(0, "tm_shot_" + _Symbol + "_" + EnumToString(_Period) + ".png", 1280, 720, ALIGN_RIGHT);
      Print("TMSHOT done");
      ExpertRemove();
     }
  }
#endif

void OnTimer() { AT24Gate_Timer(InpLicenseKey); Cycle();
#ifdef AT24_SHOT
   ShotCycle();
#endif
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK) return;
   if(StringFind(sparam, PFX + "b_") != 0) return;
   ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
   if(sparam == PFX + "b_buy") Send(1);
   else if(sparam == PFX + "b_sell") Send(-1);
   else if(sparam == PFX + "b_rm") gRiskPct = MathMax(0.25, gRiskPct - 0.25);
   else if(sparam == PFX + "b_rp") gRiskPct = MathMin(10.0, gRiskPct + 0.25);
   else if(sparam == PFX + "b_flip")
     {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double sl = LinePrice(PFX + "SL"), tp = LinePrice(PFX + "TP");
      if(sl <= 0) DefaultLines();
      else
        {
         MkLine(PFX + "SL", NormalizeDouble(2 * bid - sl, _Digits), C'230,90,90');
         if(tp > 0) MkLine(PFX + "TP", NormalizeDouble(2 * bid - tp, _Digits), C'45,200,180');
        }
     }
   else if(sparam == PFX + "b_be") ScopeAction(1);
   else if(sparam == PFX + "b_half") ScopeAction(2);
   else if(sparam == PFX + "b_all") ScopeAction(3);
   else if(sparam == PFX + "b_peak")
     { gPeak = AccountInfoDouble(ACCOUNT_EQUITY); gDDLock = false; GSet("peak", gPeak); GSet("ddlock", 0); Say("Peak reset to current equity"); }
   else if(sparam == PFX + "b_abe") gAutoBE = !gAutoBE;
   else if(sparam == PFX + "b_apt") gAutoPartial = !gAutoPartial;
   else if(sparam == PFX + "b_atr") gTrailOn = !gTrailOn;
   Refresh();
  }
