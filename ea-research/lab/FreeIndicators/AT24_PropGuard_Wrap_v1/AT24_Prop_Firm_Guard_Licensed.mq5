//+------------------------------------------------------------------+
//| AT24 Prop Firm Guard - account rule monitor and enforcer.        |
//| Watches the whole account (all symbols, all expert advisors),    |
//| shows how much of each rule is used and closes positions before  |
//| a limit is broken. Opens no trades.                              |
//+------------------------------------------------------------------+
#property copyright "Algotraders24 AI"
#property version   "1.00"
#property description "Daily loss, maximum loss, profit target, trading days, open risk, Friday close and quiet hours for challenge and funded accounts."
#property description "Watches the whole account and closes positions before a limit is reached. Opens no trades. Not financial advice."

#define AT24_PRODUCT_ID "AT24-PROP-FIRM-GUARD"
#include "AT24_LicenseGate.mqh"
#include <Trade/Trade.mqh>

input string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)

enum ENUM_AT24_BASIS { BASIS_INITIAL = 0, BASIS_DAYSTART = 1 };
enum ENUM_AT24_MAXMODE { MAX_STATIC = 0, MAX_TRAILING = 1 };

input group "Account"
input double           InpStartBalance  = 0.0;            // Initial balance of the challenge (0 = balance when first attached)
input double           InpDailyLossPct  = 5.0;            // Daily loss limit in percent (0 = off)
input ENUM_AT24_BASIS  InpDailyBasis    = BASIS_INITIAL;  // Daily limit is a percent of
input int              InpDayResetHour  = 0;              // Server hour when the trading day starts
input double           InpMaxLossPct    = 10.0;           // Maximum loss limit in percent (0 = off)
input ENUM_AT24_MAXMODE InpMaxMode      = MAX_STATIC;     // Maximum loss counted from initial balance or from peak equity
input double           InpTargetPct     = 10.0;           // Profit target in percent (0 = off)
input int              InpMinDays       = 4;              // Minimum trading days (0 = off)
input group "Safety margin"
input double           InpWarnAtPct     = 70.0;           // Warn when this share of a limit is used
input double           InpActAtPct      = 92.0;           // Act (close and lock) when this share of a limit is used
input bool             InpCloseOnAct    = true;           // Close all positions and delete pending orders when acting
input bool             InpLockAtTarget  = false;          // Close all and lock when the profit target is reached
input group "Open risk"
input double           InpMaxOpenRiskPct = 0.0;           // Maximum total risk of open positions in percent (0 = off)
input group "Schedule (server time, -1 = off)"
input int              InpFridayCloseHour = -1;           // Close all positions on Friday from this hour
input int              InpQuietFrom     = -1;             // Quiet hours start: positions opened inside are closed
input int              InpQuietTo       = -1;             // Quiet hours end
input group "Alerts and panel"
input bool             InpAlerts        = true;           // Alert and push message
input int              InpPanelX        = 10;             // Panel X
input int              InpPanelY        = 24;             // Panel Y

#define PFX "AT24PG_"
#define PW 300
CTrade   trade;
double   gStart = 0, gPeak = 0, gDayBase = 0, gEq = 0;
datetime gDay = 0, gStartTime = 0;
bool     gDayLock = false, gTotalLock = false, gTargetDone = false, gWarnDay = false, gWarnTot = false, gOpenRiskFlag = false;
int      gTradeDays = 0, gNoSL = 0;
datetime gLastDays = 0, gDayTradesCalc = 0;
double   gOpenRisk = 0;
string   gMsg = "";
datetime gMsgTime = 0;
color    C_BG = C'10,22,40', C_BORDER = C'240,180,41', C_TXT = C'200,210,220', C_DIM = C'120,135,150', C_RED = C'230,90,90', C_GREEN = C'45,200,180';

string GKey(const string s) { return PFX + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + s; }
void   GSet(const string s, const double v) { GlobalVariableSet(GKey(s), v); }
double GGet(const string s, const double def) { return GlobalVariableCheck(GKey(s)) ? GlobalVariableGet(GKey(s)) : def; }
void   Say(const string m) { gMsg = m; gMsgTime = TimeCurrent(); }

void Notify(const string m)
  {
   Print(m);
   if(InpAlerts) { Alert(m); SendNotification(m); }
  }

//+------------------------------------------------------------------+
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
  }

void MkBar(const string n, int x, int y, int w, double frac, color c)
  {
   MkRect(n + "_b", x, y, w, 8, C'30,45,66', C'30,45,66');
   int fw = (int)MathMax(0, MathMin(w, w * frac));
   MkRect(n + "_f", x, y, MathMax(fw, 1), 8, c, c);
  }

//+------------------------------------------------------------------+
//| Rules                                                            |
//+------------------------------------------------------------------+
double DailyBasisMoney() { return (InpDailyBasis == BASIS_INITIAL) ? gStart : gDayBase; }
double DailyLimitMoney() { return DailyBasisMoney() * InpDailyLossPct / 100.0; }
double MaxLossLimitMoney() { return gStart * InpMaxLossPct / 100.0; }

double DailyLossNow() { return MathMax(0, gDayBase - gEq); }
double TotalLossNow() { return (InpMaxMode == MAX_STATIC) ? MathMax(0, gStart - gEq) : MathMax(0, gPeak - gEq); }

double ClosedSince(const datetime t)
  {
   double sum = 0;
   if(!HistorySelect(t, TimeCurrent() + 60)) return 0;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long ty = HistoryDealGetInteger(d, DEAL_TYPE);
      if(ty != DEAL_TYPE_BUY && ty != DEAL_TYPE_SELL) continue;
      sum += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_SWAP) + HistoryDealGetDouble(d, DEAL_FEE);
     }
   return sum;
  }

datetime DayStartOf(const datetime t)
  {
   datetime base = (datetime)((long)t / 86400 * 86400) + InpDayResetHour * 3600;
   if(base > t) base -= 86400;
   return base;
  }

void DayRoll()
  {
   datetime ds = DayStartOf(TimeCurrent());
   if(ds != gDay)
     {
      gDay = ds;
      double bal = AccountInfoDouble(ACCOUNT_BALANCE) - ClosedSince(gDay);
      gDayBase = bal;
      gDayLock = false; gWarnDay = false;
      GSet("day", (double)gDay); GSet("daybase", gDayBase);
     }
  }

void CountDays()
  {
   if(TimeCurrent() - gLastDays < 60) return;
   gLastDays = TimeCurrent();
   if(!HistorySelect(gStartTime, TimeCurrent() + 60)) return;
   datetime seen[]; int n = 0;
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long ty = HistoryDealGetInteger(d, DEAL_TYPE);
      if(ty != DEAL_TYPE_BUY && ty != DEAL_TYPE_SELL) continue;
      datetime day = (datetime)((long)HistoryDealGetInteger(d, DEAL_TIME) / 86400 * 86400);
      bool f = false;
      for(int k = 0; k < n; k++) if(seen[k] == day) { f = true; break; }
      if(!f) { ArrayResize(seen, n + 1); seen[n++] = day; }
     }
   gTradeDays = n;
  }

void CloseEverything()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t > 0) trade.PositionClose(t, 30);
     }
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t > 0) trade.OrderDelete(t);
     }
  }

double PositionRisk(const ulong ticket)
  {
   if(!PositionSelectByTicket(ticket)) return 0;
   string s = PositionGetString(POSITION_SYMBOL);
   double sl = PositionGetDouble(POSITION_SL), op = PositionGetDouble(POSITION_PRICE_OPEN), vol = PositionGetDouble(POSITION_VOLUME);
   if(sl <= 0) return -1;
   double ts = SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE), tv = SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE);
   if(ts <= 0 || tv <= 0) return 0;
   long ty = PositionGetInteger(POSITION_TYPE);
   double dist = (ty == POSITION_TYPE_BUY) ? op - sl : sl - op;
   if(dist <= 0) return 0; // stop is beyond break-even: no open risk
   return dist / ts * tv * vol;
  }

void OpenRiskScan()
  {
   gOpenRisk = 0; gNoSL = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      double r = PositionRisk(t);
      if(r < 0) gNoSL++; else gOpenRisk += r;
     }
   if(InpMaxOpenRiskPct > 0 && gStart > 0 && gOpenRisk / gStart * 100.0 > InpMaxOpenRiskPct)
     {
      // close the newest position until the total is back under the limit
      ulong newest = 0; datetime nt = 0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0) continue;
         datetime pt = (datetime)PositionGetInteger(POSITION_TIME);
         if(pt >= nt) { nt = pt; newest = t; }
        }
      if(newest > 0 && trade.PositionClose(newest, 30))
        {
         Say("Open risk limit: newest position closed");
         if(!gOpenRiskFlag) { gOpenRiskFlag = true; Notify("AT24 Prop Firm Guard: open risk limit reached, newest position closed"); }
        }
     }
   else gOpenRiskFlag = false;
  }

bool InQuiet(const datetime t)
  {
   if(InpQuietFrom < 0 || InpQuietTo < 0) return false;
   MqlDateTime d; TimeToStruct(t, d);
   if(InpQuietFrom == InpQuietTo) return false;
   if(InpQuietFrom < InpQuietTo) return (d.hour >= InpQuietFrom && d.hour < InpQuietTo);
   return (d.hour >= InpQuietFrom || d.hour < InpQuietTo);
  }

void Schedule()
  {
   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   if(InpFridayCloseHour >= 0 && d.day_of_week == 5 && d.hour >= InpFridayCloseHour && (PositionsTotal() > 0 || OrdersTotal() > 0))
     { CloseEverything(); Say("Friday close"); return; }
   if(InpQuietFrom >= 0 && InpQuietTo >= 0)
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0) continue;
         if(InQuiet((datetime)PositionGetInteger(POSITION_TIME)) && InQuiet(TimeCurrent()))
           { if(trade.PositionClose(t, 30)) Say("Quiet hours: position closed"); }
        }
  }

void Rules()
  {
   DayRoll();
   gEq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(gEq > gPeak) { gPeak = gEq; GSet("peak", gPeak); }
   double dUsed = (InpDailyLossPct > 0 && DailyLimitMoney() > 0) ? DailyLossNow() / DailyLimitMoney() * 100.0 : 0;
   double tUsed = (InpMaxLossPct > 0 && MaxLossLimitMoney() > 0) ? TotalLossNow() / MaxLossLimitMoney() * 100.0 : 0;
   if(dUsed >= InpWarnAtPct && !gWarnDay) { gWarnDay = true; Notify(StringFormat("AT24 Prop Firm Guard: %.0f%% of the daily loss limit is used", dUsed)); }
   if(tUsed >= InpWarnAtPct && !gWarnTot) { gWarnTot = true; Notify(StringFormat("AT24 Prop Firm Guard: %.0f%% of the maximum loss limit is used", tUsed)); }
   if(tUsed < InpWarnAtPct * 0.8) gWarnTot = false;
   bool wasDay = gDayLock, wasTot = gTotalLock;
   if(dUsed >= InpActAtPct && InpDailyLossPct > 0) gDayLock = true;
   if(tUsed >= InpActAtPct && InpMaxLossPct > 0) { gTotalLock = true; GSet("totlock", 1); }
   double profPct = (gStart > 0) ? (gEq - gStart) / gStart * 100.0 : 0;
   if(InpTargetPct > 0 && profPct >= InpTargetPct && !gTargetDone)
     {
      gTargetDone = true; GSet("target", 1);
      Notify(StringFormat("AT24 Prop Firm Guard: profit target %.1f%% reached", InpTargetPct));
      if(InpLockAtTarget) { CloseEverything(); gDayLock = true; }
     }
   if((gDayLock && !wasDay) || (gTotalLock && !wasTot))
     {
      Notify(gTotalLock && !wasTot ? "AT24 Prop Firm Guard: maximum loss limit nearly reached, positions closed and account locked"
                                    : "AT24 Prop Firm Guard: daily loss limit nearly reached, positions closed and trading locked for today");
      Say("LOCKED");
     }
   bool locked = gDayLock || gTotalLock || (gTargetDone && InpLockAtTarget);
   if(locked && InpCloseOnAct && (PositionsTotal() > 0 || OrdersTotal() > 0)) CloseEverything();
   if(!locked) { Schedule(); OpenRiskScan(); }
   CountDays();
  }

//+------------------------------------------------------------------+
void BuildPanel()
  {
   MkRect(PFX + "bg", 0, 0, PW, 252, C_BG, C_BORDER);
   MkLabel(PFX + "t0", 10, 6, "AT24 PROP FIRM GUARD", C_BORDER, 10);
   for(int i = 0; i < 12; i++) MkLabel(PFX + "l" + IntegerToString(i), 10, 28 + i * 17, " ", C_TXT);
  }

void Txt(const int i, const string s, color c = C'200,210,220')
  {
   ObjectSetString(0, PFX + "l" + IntegerToString(i), OBJPROP_TEXT, s);
   ObjectSetInteger(0, PFX + "l" + IntegerToString(i), OBJPROP_COLOR, c);
  }

color UseColor(const double used) { return used >= InpActAtPct ? C_RED : (used >= InpWarnAtPct ? clrOrange : C_GREEN); }

void Refresh()
  {
   double dUsed = (InpDailyLossPct > 0 && DailyLimitMoney() > 0) ? DailyLossNow() / DailyLimitMoney() * 100.0 : 0;
   double tUsed = (InpMaxLossPct > 0 && MaxLossLimitMoney() > 0) ? TotalLossNow() / MaxLossLimitMoney() * 100.0 : 0;
   double profPct = (gStart > 0) ? (gEq - gStart) / gStart * 100.0 : 0;
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   Txt(0, StringFormat("Equity %.2f %s   start %.2f", gEq, cur, gStart));
   if(InpDailyLossPct > 0)
     {
      Txt(1, StringFormat("Daily loss  %.0f%% of %.1f%%  (%.2f left)", dUsed, InpDailyLossPct, MathMax(0, DailyLimitMoney() - DailyLossNow())), UseColor(dUsed));
      MkBar(PFX + "bd", 10, 66, PW - 20, dUsed / 100.0, UseColor(dUsed));
     }
   else Txt(1, "Daily loss: off", C_DIM);
   if(InpMaxLossPct > 0)
     {
      Txt(3, StringFormat("Maximum loss  %.0f%% of %.1f%%  (%.2f left)", tUsed, InpMaxLossPct, MathMax(0, MaxLossLimitMoney() - TotalLossNow())), UseColor(tUsed));
      MkBar(PFX + "bt", 10, 100, PW - 20, tUsed / 100.0, UseColor(tUsed));
     }
   else Txt(3, "Maximum loss: off", C_DIM);
   if(InpTargetPct > 0)
     {
      Txt(5, StringFormat("Profit %+.2f%%  target %.1f%%%s", profPct, InpTargetPct, gTargetDone ? "  REACHED" : ""), gTargetDone ? C_GREEN : C_TXT);
      MkBar(PFX + "bp", 10, 134, PW - 20, MathMax(0, profPct) / InpTargetPct, C_BORDER);
     }
   else Txt(5, StringFormat("Profit %+.2f%%", profPct));
   if(InpMinDays > 0) Txt(7, StringFormat("Trading days %d of %d", gTradeDays, InpMinDays), gTradeDays >= InpMinDays ? C_GREEN : C_TXT);
   else Txt(7, StringFormat("Trading days %d", gTradeDays));
   string orisk = StringFormat("Open risk %.2f%%", gStart > 0 ? gOpenRisk / gStart * 100.0 : 0);
   if(InpMaxOpenRiskPct > 0) orisk += StringFormat(" of %.1f%%", InpMaxOpenRiskPct);
   if(gNoSL > 0) orisk += StringFormat("   %d without SL", gNoSL);
   Txt(8, orisk, gNoSL > 0 ? clrOrange : C_TXT);
   string st = gTotalLock ? "LOCKED: maximum loss" : (gDayLock ? "LOCKED for today (daily loss)" : "Guarding");
   if(gMsg != "" && TimeCurrent() - gMsgTime < 10) st = gMsg;
   Txt(10, st, (gDayLock || gTotalLock) ? C_RED : C_BORDER);
   Txt(11, "Watches all symbols. Opens no trades.", C_DIM);
   ChartRedraw(0);
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey))
      return INIT_FAILED;
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);
   gEq = AccountInfoDouble(ACCOUNT_EQUITY);
   gStart = (InpStartBalance > 0) ? InpStartBalance : GGet("start", AccountInfoDouble(ACCOUNT_BALANCE));
   GSet("start", gStart);
   gStartTime = (datetime)(long)GGet("starttime", (double)TimeCurrent());
   GSet("starttime", (double)gStartTime);
   gPeak = MathMax(GGet("peak", gEq), gEq);
   gTotalLock = (GGet("totlock", 0) == 1);
   gTargetDone = (GGet("target", 0) == 1);
   gDay = (datetime)(long)GGet("day", 0);
   gDayBase = GGet("daybase", 0);
   DayRoll();
   if(gDayBase <= 0) gDayBase = AccountInfoDouble(ACCOUNT_BALANCE);
   BuildPanel();
   EventSetTimer(1);
   Rules();
   Refresh();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0, PFX);
  }

#ifdef AT24_SELFTEST
int gST = 0;
void SelfTest()
  {
   gST++;
   if(gST % 400 == 3 && PositionsTotal() == 0 && !gDayLock) { trade.Buy(0.5, _Symbol, 0, 0, 0, "PG test"); Print("ST buy: ", trade.ResultRetcodeDescription()); }
   if(gST % 20 == 0) Print("ST ", gST, " pos=", PositionsTotal(), " dayLock=", gDayLock, " totLock=", gTotalLock, " dUsedLoss=", DoubleToString(DailyLossNow(), 2), " openRisk=", DoubleToString(gOpenRisk, 2), " noSL=", gNoSL, " msg=", gMsg);
  }
#endif

void Cycle()
  {
   Rules();
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
      ChartScreenShot(0, "pg_shot_" + _Symbol + "_" + EnumToString(_Period) + ".png", 1280, 720, ALIGN_RIGHT);
      Print("PGSHOT done");
      ExpertRemove();
     }
  }
#endif

void OnTimer()
  {
   AT24Gate_Timer(InpLicenseKey);   // the guard keeps watching the account even if the licence check fails later
   Cycle();
#ifdef AT24_SHOT
   ShotCycle();
#endif
  }
