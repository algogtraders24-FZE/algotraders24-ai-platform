//+------------------------------------------------------------------+
//| AT24 Basket Closer - close a group of trades with one click,     |
//| or automatically at a profit target, a loss limit or a trailing  |
//| basket profit. Opens no trades.                                  |
//+------------------------------------------------------------------+
#property copyright "Algotraders24 AI"
#property version   "1.00"
#property description "Closes all trades, winners, losers, buys or sells with one click, or by a profit target, loss limit or trailing basket profit."
#property description "Works on all symbols, the chart symbol or one magic number. Opens no trades. Not financial advice."
#property strict

#include <Trade/Trade.mqh>

enum ENUM_AT24_BSCOPE { BS_ALL = 0, BS_SYMBOL = 1, BS_MAGIC = 2 };

input group "Basket"
input ENUM_AT24_BSCOPE InpScope   = BS_ALL;   // Which trades form the basket at start
input long   InpMagic            = 0;         // Magic number (used when the scope is Magic number)
input bool   InpDeletePending    = true;      // Also delete pending orders of the basket when closing everything
input int    InpDeviation        = 30;        // Max slippage (points)
input group "Automatic close"
input bool   InpAutoOn           = false;     // Automatic rules on at start
input double InpTargetMoney      = 0.0;       // Close the basket when net profit reaches this amount (0 = off)
input double InpTargetPct        = 0.0;       // Close the basket when net profit reaches this percent of balance (0 = off)
input double InpLossMoney        = 0.0;       // Close the basket when net loss reaches this amount (0 = off)
input double InpLossPct          = 0.0;       // Close the basket when net loss reaches this percent of balance (0 = off)
input double InpTrailStartMoney  = 0.0;       // Trailing basket profit starts at this net profit (0 = off)
input double InpTrailGivePct     = 30.0;      // Close when profit falls this percent below its peak (trailing)
input bool   InpAlerts           = true;      // Alert and push message when an automatic rule closes the basket
input group "Panel"
input int    InpPanelX           = 10;        // Panel X
input int    InpPanelY           = 24;        // Panel Y

#define PFX "AT24BC_"
CTrade   trade;
int      gScope;                 // current scope 0 all, 1 symbol, 2 magic
bool     gAuto;
double   gPeakProfit = 0;        // highest net profit of the current basket
bool     gTrailArmed = false;
string   gMsg = "";
datetime gMsgTime = 0;
datetime gArm = 0;               // time of the first click of a close button (second click confirms)
string   gArmBtn = "";
bool     gBusy = false;

void Say(const string m) { gMsg = m; gMsgTime = TimeCurrent(); }

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
   MkRect(PFX + "bg", 0, 0, PW, 292, C_BG, C_BORDER);
   MkLabel(PFX + "t0", 10, 6, "AT24 BASKET CLOSER", C_BORDER, 10);
   for(int i = 0; i < 8; i++) MkLabel(PFX + "l" + IntegerToString(i), 10, 28 + i * 17, " ", C_TXT);
   MkBtn(PFX + "b_all",   10, 168, 260, 28, "CLOSE ALL", C'170,60,65');
   MkBtn(PFX + "b_win",   10, 200, 128, 22, "CLOSE WINNERS", C'25,120,100');
   MkBtn(PFX + "b_los",  142, 200, 128, 22, "CLOSE LOSERS", C'120,50,55');
   MkBtn(PFX + "b_buy",   10, 226, 128, 22, "CLOSE BUYS", C'40,55,75');
   MkBtn(PFX + "b_sell", 142, 226, 128, 22, "CLOSE SELLS", C'40,55,75');
   MkBtn(PFX + "b_scope", 10, 252, 128, 22, " ", C'40,55,75');
   MkBtn(PFX + "b_auto", 142, 252, 128, 22, " ", C'40,55,75');
  }

void Txt(const int i, const string s, color c = C'200,210,220')
  {
   ObjectSetString(0, PFX + "l" + IntegerToString(i), OBJPROP_TEXT, s == "" ? " " : s);
   ObjectSetInteger(0, PFX + "l" + IntegerToString(i), OBJPROP_COLOR, c);
  }

//+------------------------------------------------------------------+
//| Basket                                                           |
//+------------------------------------------------------------------+
struct SBasket
  {
   int    n, buys, sells, wins, losses, pending;
   double lots, profit, best, worst, winSum, lossSum;
  };

bool InBasket(const string sym, const long magic)
  {
   if(gScope == BS_SYMBOL && sym != _Symbol) return false;
   if(gScope == BS_MAGIC && magic != InpMagic) return false;
   return true;
  }

void Scan(SBasket &b)
  {
   b.n = 0; b.buys = 0; b.sells = 0; b.wins = 0; b.losses = 0; b.pending = 0;
   b.lots = 0; b.profit = 0; b.best = 0; b.worst = 0; b.winSum = 0; b.lossSum = 0;
   bool first = true;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(!InBasket(PositionGetString(POSITION_SYMBOL), PositionGetInteger(POSITION_MAGIC))) continue;
      double p = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      b.n++;
      if(PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) b.buys++; else b.sells++;
      b.lots += PositionGetDouble(POSITION_VOLUME);
      b.profit += p;
      if(p >= 0) { b.wins++; b.winSum += p; } else { b.losses++; b.lossSum += p; }
      if(first || p > b.best) b.best = p;
      if(first || p < b.worst) b.worst = p;
      first = false;
     }
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0) continue;
      if(InBasket(OrderGetString(ORDER_SYMBOL), OrderGetInteger(ORDER_MAGIC))) b.pending++;
     }
  }

// mode: 0 all, 1 winners, 2 losers, 3 buys, 4 sells. Returns number closed; failed gets the number that could not be closed.
int gDeleted = 0;
int CloseBasket(const int mode, int &failed, const bool delPending)
  {
   failed = 0; gDeleted = 0;
   ulong tk[]; int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(!InBasket(PositionGetString(POSITION_SYMBOL), PositionGetInteger(POSITION_MAGIC))) continue;
      double p = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      long ty = PositionGetInteger(POSITION_TYPE);
      if(mode == 1 && p <= 0) continue;
      if(mode == 2 && p >= 0) continue;
      if(mode == 3 && ty != POSITION_TYPE_BUY) continue;
      if(mode == 4 && ty != POSITION_TYPE_SELL) continue;
      ArrayResize(tk, n + 1); tk[n++] = t;
     }
   int done = 0;
   for(int k = 0; k < n; k++)
     {
      bool ok = false;
      for(int tries = 0; tries < 3 && !ok; tries++)
        {
         if(!PositionSelectByTicket(tk[k])) { ok = true; break; }       // already gone
         trade.SetTypeFillingBySymbol(PositionGetString(POSITION_SYMBOL));
         ok = trade.PositionClose(tk[k], (ulong)InpDeviation);
         if(ok && trade.ResultRetcode() != TRADE_RETCODE_DONE && trade.ResultRetcode() != TRADE_RETCODE_PLACED) ok = false;
         if(!ok) Sleep(150);
        }
      if(ok) done++; else failed++;
     }
   if(delPending && mode == 0)
      for(int i = OrdersTotal() - 1; i >= 0; i--)
        {
         ulong t = OrderGetTicket(i);
         if(t == 0) continue;
         if(!InBasket(OrderGetString(ORDER_SYMBOL), OrderGetInteger(ORDER_MAGIC))) continue;
         if(!trade.OrderDelete(t)) failed++; else gDeleted++;
        }
   return done;
  }

void DoClose(const int mode, const string why)
  {
   if(gBusy) return;
   gBusy = true;
   int failed = 0;
   int done = CloseBasket(mode, failed, InpDeletePending);
   string what[5] = {"all", "winners", "losers", "buys", "sells"};
   string m = StringFormat("%s: closed %d (%s)", why, done, what[mode]);
   if(gDeleted > 0) m += StringFormat(", %d pending deleted", gDeleted);
   if(failed > 0) m += StringFormat(", %d NOT closed - check the Experts tab", failed);
   Say(m);
   Print("[AT24-BC] ", m);
   if(mode == 0) { gPeakProfit = 0; gTrailArmed = false; }
   gBusy = false;
  }

//+------------------------------------------------------------------+
//| Automatic rules                                                  |
//+------------------------------------------------------------------+
void AutoRules(const SBasket &b)
  {
   if(b.n == 0) { gPeakProfit = 0; gTrailArmed = false; return; }
   if(!gAuto) return;
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double pr = b.profit;
   if(pr > gPeakProfit) gPeakProfit = pr;
   string why = "";
   if(InpTargetMoney > 0 && pr >= InpTargetMoney) why = StringFormat("profit target %.2f reached", InpTargetMoney);
   else if(InpTargetPct > 0 && bal > 0 && pr >= bal * InpTargetPct / 100.0) why = StringFormat("profit target %.2f%% reached", InpTargetPct);
   else if(InpLossMoney > 0 && pr <= -InpLossMoney) why = StringFormat("loss limit %.2f reached", InpLossMoney);
   else if(InpLossPct > 0 && bal > 0 && pr <= -bal * InpLossPct / 100.0) why = StringFormat("loss limit %.2f%% reached", InpLossPct);
   if(why == "" && InpTrailStartMoney > 0)
     {
      if(!gTrailArmed && gPeakProfit >= InpTrailStartMoney) gTrailArmed = true;
      if(gTrailArmed && InpTrailGivePct > 0 && pr <= gPeakProfit * (1.0 - InpTrailGivePct / 100.0))
         why = StringFormat("trailing: profit %.2f fell %.0f%% below its peak %.2f", pr, InpTrailGivePct, gPeakProfit);
     }
   if(why == "") return;
   DoClose(0, why);
   string msg = "AT24 Basket Closer: " + why;
   if(InpAlerts) { Alert(msg); SendNotification(msg); }
  }

//+------------------------------------------------------------------+
//| Display                                                          |
//+------------------------------------------------------------------+
string ScopeName()
  {
   if(gScope == BS_SYMBOL) return "this symbol (" + _Symbol + ")";
   if(gScope == BS_MAGIC) return "magic " + IntegerToString(InpMagic);
   return "all trades";
  }

void Refresh()
  {
   SBasket b; Scan(b);
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   color cp = b.profit > 0 ? C'45,200,180' : (b.profit < 0 ? C'230,90,90' : C_TXT);
   Txt(0, "Basket: " + ScopeName());
   Txt(1, StringFormat("Positions %d   (buys %d / sells %d)   lots %.2f", b.n, b.buys, b.sells, b.lots));
   Txt(2, StringFormat("Net P/L %.2f %s   (%.2f%% of balance)", b.profit, cur, bal > 0 ? b.profit / bal * 100.0 : 0.0), cp);
   Txt(3, StringFormat("Winners %d (%.2f)   Losers %d (%.2f)", b.wins, b.winSum, b.losses, b.lossSum));
   Txt(4, b.n > 0 ? StringFormat("Best %.2f   Worst %.2f   Pending orders %d", b.best, b.worst, b.pending) : StringFormat("No open positions   Pending orders %d", b.pending), C_DIM);
   string rule = "Auto: OFF";
   if(gAuto)
     {
      rule = "Auto ON:";
      if(InpTargetMoney > 0) rule += StringFormat(" TP %.0f", InpTargetMoney);
      if(InpTargetPct > 0) rule += StringFormat(" TP %.1f%%", InpTargetPct);
      if(InpLossMoney > 0) rule += StringFormat(" SL %.0f", InpLossMoney);
      if(InpLossPct > 0) rule += StringFormat(" SL %.1f%%", InpLossPct);
      if(InpTrailStartMoney > 0) rule += StringFormat(" trail %.0f/%.0f%%", InpTrailStartMoney, InpTrailGivePct);
      if(rule == "Auto ON:") rule = "Auto ON: no rule set in the inputs";
     }
   Txt(5, rule, gAuto ? C_BORDER : C_DIM);
   if(gTrailArmed) Txt(6, StringFormat("Trailing armed, peak %.2f", gPeakProfit), C_BORDER); else Txt(6, "");
   bool recent = (gMsg != "" && TimeCurrent() - gMsgTime < 20);
   Txt(7, recent ? gMsg : "Click a close button twice to confirm", recent ? C_BORDER : C_DIM);
   ObjectSetString(0, PFX + "b_scope", OBJPROP_TEXT, "SCOPE: " + (gScope == BS_ALL ? "ALL" : (gScope == BS_SYMBOL ? "SYMBOL" : "MAGIC")));
   ObjectSetString(0, PFX + "b_auto", OBJPROP_TEXT, gAuto ? "AUTO: ON" : "AUTO: OFF");
   string names[5] = {"b_all", "b_win", "b_los", "b_buy", "b_sell"};
   string base[5] = {"CLOSE ALL", "CLOSE WINNERS", "CLOSE LOSERS", "CLOSE BUYS", "CLOSE SELLS"};
   for(int i = 0; i < 5; i++)
      ObjectSetString(0, PFX + names[i], OBJPROP_TEXT, (gArmBtn == names[i] && TimeCurrent() - gArm < 4) ? "CLICK AGAIN TO CONFIRM" : base[i]);
   ChartRedraw(0);
   AutoRules(b);
  }

void OnChartEvent(const int id, const long &lp, const double &dp, const string &sp)
  {
   if(id != CHARTEVENT_OBJECT_CLICK) return;
   if(StringFind(sp, PFX) != 0) return;
   string n = StringSubstr(sp, StringLen(PFX));
   ObjectSetInteger(0, sp, OBJPROP_STATE, false);
   if(n == "b_scope") { gScope = (gScope + 1) % 3; gPeakProfit = 0; gTrailArmed = false; Say("Scope: " + ScopeName()); Refresh(); return; }
   if(n == "b_auto")  { gAuto = !gAuto; Say(gAuto ? "Automatic rules ON" : "Automatic rules OFF"); Refresh(); return; }
   int mode = -1;
   if(n == "b_all") mode = 0; else if(n == "b_win") mode = 1; else if(n == "b_los") mode = 2; else if(n == "b_buy") mode = 3; else if(n == "b_sell") mode = 4;
   if(mode < 0) return;
   if(gArmBtn == n && TimeCurrent() - gArm < 4)
     {
      gArmBtn = ""; gArm = 0;
      string w[5] = {"Close all", "Close winners", "Close losers", "Close buys", "Close sells"};
      DoClose(mode, w[mode]);
     }
   else { gArmBtn = n; gArm = TimeCurrent(); }
   Refresh();
  }

#ifdef AT24_SELFTEST
int gST = 0;
void SelfTest()
  {
   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   if(d.hour < 3) return;                       // market is closed at the start of the test day
   gST++;
   if(gST == 3)  { trade.Buy(0.10, _Symbol, 0, 0, 0, "BC test"); trade.Sell(0.10, _Symbol, 0, 0, 0, "BC test"); trade.Buy(0.20, _Symbol, 0, 0, 0, "BC test"); }
   if(gST == 12) { Print("ST before: ", PositionsTotal()); DoClose(3, "test buys"); Print("ST after buys: ", PositionsTotal()); }
   if(gST == 16) { DoClose(0, "test all"); Print("ST after all: ", PositionsTotal()); }
   if(gST == 20) { trade.Buy(0.10, _Symbol, 0, 0, 0, "BC test"); trade.Sell(0.10, _Symbol, 0, 0, 0, "BC test"); gAuto = true; }
  }
#endif

#ifdef AT24_SELFTEST2
int gST2 = 0;
void SelfTest()
  {
   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   if(d.hour < 3) return;
   gST2++;
   if(gST2 % 3600 == 3 && PositionsTotal() == 0) { trade.Buy(1.0, _Symbol, 0, 0, 0, "BC test"); trade.BuyLimit(0.10, SymbolInfoDouble(_Symbol, SYMBOL_ASK) - 300 * _Point * 10, _Symbol, 0, 0, ORDER_TIME_GTC, 0, "BC test"); }
  }
#endif

#ifdef AT24_SHOT
int gSH = 0;
void ShotCycle()
  {
   gSH++;
   if(gSH == 1)
     {
      ChartSetInteger(0, CHART_MODE, CHART_CANDLES); ChartSetInteger(0, CHART_SCALE, 4);
      ChartSetInteger(0, CHART_SHOW_GRID, false); ChartSetInteger(0, CHART_SHOW_VOLUMES, CHART_VOLUME_HIDE);
      ChartSetInteger(0, CHART_SHOW_ASK_LINE, false); ChartSetInteger(0, CHART_SHOW_PERIOD_SEP, false);
      ChartSetInteger(0, CHART_SHIFT, true); ChartSetDouble(0, CHART_SHIFT_SIZE, 20.0);
      ChartSetInteger(0, CHART_COLOR_BACKGROUND, C'10,22,40'); ChartSetInteger(0, CHART_COLOR_FOREGROUND, C'200,210,220');
      ChartSetInteger(0, CHART_COLOR_CANDLE_BULL, C'45,200,180'); ChartSetInteger(0, CHART_COLOR_CANDLE_BEAR, C'230,90,90');
      ChartSetInteger(0, CHART_COLOR_CHART_UP, C'45,200,180'); ChartSetInteger(0, CHART_COLOR_CHART_DOWN, C'230,90,90');
      ChartSetInteger(0, CHART_COLOR_CHART_LINE, C'200,210,220');
     }
   if(gSH == 3)
     {
      trade.Buy(0.10, _Symbol, 0, 0, 0, "BC shot"); trade.Sell(0.04, _Symbol, 0, 0, 0, "BC shot");
      trade.Buy(0.06, "EURUSD", 0, 0, 0, "BC shot"); trade.Sell(0.08, "EURUSD", 0, 0, 0, "BC shot"); trade.Buy(0.05, "GBPUSD", 0, 0, 0, "BC shot");
     }
   if(gSH == 25)
     {
      ChartSetInteger(0, CHART_SHOW_TRADE_LEVELS, false);
      ChartRedraw(0);
      ChartScreenShot(0, "bc_shot_" + _Symbol + ".png", 1280, 720, ALIGN_RIGHT);
      Print("BC SHOT done");
     }
   if(gSH == 30) { gScope = BS_ALL; DoClose(0, "shot cleanup"); }
  }
#endif

//+------------------------------------------------------------------+
int OnInit()
  {
   gScope = (int)InpScope;
   gAuto = InpAutoOn;
   trade.SetDeviationInPoints(InpDeviation);
   BuildPanel();
   EventSetTimer(1);
   Refresh();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   ObjectsDeleteAll(0, PFX);
   Comment("");
  }

void OnTick() { Refresh(); }
void OnTimer()
  {
#ifdef AT24_SELFTEST
   SelfTest();
#endif
#ifdef AT24_SELFTEST2
   SelfTest();
#endif
#ifdef AT24_SHOT
   ShotCycle();
#endif
   Refresh();
  }
//+------------------------------------------------------------------+
