//+------------------------------------------------------------------+
//| AT24 Daily Risk Panel (MT5)                                      |
//| Today's loss against YOUR daily limit, trades taken, the risk of |
//| open positions to their stops, and a counter for YOUR rules      |
//| broken today.                                                    |
//| Tracker. Never places or closes trades. Not advice.              |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Daily Risk Panel - daily loss used, trades today, open risk, rule-break counter."
#property description "It only watches and warns. It never places, modifies or closes trades."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_DR_Core.mqh"

#resource "dr_logo56.bmp"

input group "=== Your rules ==="
input double InpDailyLossPct  = 3.0;    // Daily loss limit, % of day-start balance
input double InpMaxTradePct   = 1.0;    // Max risk per trade (to its stop), % of day-start balance
input double InpMaxOpenPct    = 3.0;    // Max total open risk, % of day-start balance
input int    InpMaxTrades     = 5;      // Max trades opened per day (0 = no limit)
input group "=== Scope ==="
input long   InpMagic         = 0;      // Only this magic number (0 = whole account)
input int    InpResetHour     = 0;      // Day starts at this broker hour
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset
input group "=== Alerts ==="
input bool   InpAlert         = true;   // Alert when a rule is broken
input bool   InpAlertPush     = false;  // Also send push notification

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24DR_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
datetime gAt = 0;
double gO[], gRisk[];
int    gTrades = 0, gBreaksToday = 0;
double gDayStart = 0.0, gClosed = 0.0, gFloat = 0.0;
bool   gLive = false;
string gLastBreak = "none";

#define DASH_W 360
#define DASH_H 262

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   gBaseX = right ? MathMax(0, w - DASH_W - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - DASH_H - InpDashY) : InpDashY;
  }

void MakeLabel(const string name, const int x, const int y, const string txt, const color c, const int size, const bool bold = false)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetString(0, n, OBJPROP_FONT, bold ? "Segoe UI Semibold" : "Segoe UI");
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_COLOR, c);
   ObjectSetInteger(0, n, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, n, OBJPROP_TEXT, txt == "" ? " " : txt);
  }

void MakeRect(const string name, const int x, const int y, const int w, const int h, const color bg)
  {
   string n = PFX + name;
   if(ObjectFind(0, n) < 0)
     {
      ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
      ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, n, OBJPROP_BACK, false);
     }
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX + x);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY + y);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, MathMax(1, w));
   ObjectSetInteger(0, n, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, n, OBJPROP_COLOR, bg);
  }

void BuildFrame()
  {
   CalcBase();
   MakeRect("bg", 0, 0, DASH_W, DASH_H, C'12,22,40');
   ObjectSetInteger(0, PFX + "bg", OBJPROP_COLOR, C'200,160,60');
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::dr_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string Money(const double v) { return StringFormat("%s%s %s", v < 0 ? "-" : "", DoubleToString(MathAbs(v), 2), AccountInfoString(ACCOUNT_CURRENCY)); }

datetime DayStart(const datetime now)
  {
   long key = ((long)now - (long)InpResetHour * 3600) / 86400;
   return (datetime)(key * 86400 + (long)InpResetHour * 3600);
  }

//--- remember a broken rule once per day (global variable), alert on the first sighting
void NoteBreak(const string what, const ulong ticket, const long dayKey)
  {
   string k = StringFormat("AT24DR_%I64d_%I64d_%s_%I64u", AccountInfoInteger(ACCOUNT_LOGIN), dayKey, what, ticket);
   if(GlobalVariableCheck(k)) return;
   GlobalVariableSet(k, 1.0);
   gLastBreak = TimeToString(TimeCurrent(), TIME_MINUTES) + " " + what;
   string msg = StringFormat("AT24 Daily Risk Panel: rule broken - %s%s", what, ticket > 0 ? StringFormat(" (#%I64u)", ticket) : "");
   Print(msg);
   if(InpAlert) { Alert(msg); if(InpAlertPush) SendNotification(msg); }
  }

int CountBreaks(const long dayKey)
  {
   string pre = StringFormat("AT24DR_%I64d_%I64d_", AccountInfoInteger(ACCOUNT_LOGIN), dayKey);
   int c = 0, tot = GlobalVariablesTotal();
   for(int i = 0; i < tot; i++) if(StringFind(GlobalVariableName(i), pre) == 0) c++;
   return c;
  }

void Reload()
  {
   gLive = (AccountInfoInteger(ACCOUNT_LOGIN) != 0 && AccountInfoDouble(ACCOUNT_BALANCE) > 0.0);
   ArrayResize(gO, 10);
   for(int z = 0; z < 10; z++) gO[z] = 0.0;
   if(!gLive) return;
   datetime now = TimeCurrent(), ds = DayStart(now);
   long dayKey = (long)ds / 86400;
   //--- today's deals: result, flows, trades opened
   double flow = 0.0, closed = 0.0; int trades = 0;
   if(HistorySelect(ds, now + 86400))
     {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
        {
         ulong tk = HistoryDealGetTicket(i);
         if(tk == 0) continue;
         long type = HistoryDealGetInteger(tk, DEAL_TYPE);
         double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_FEE);
         if(type == DEAL_TYPE_BALANCE || type == DEAL_TYPE_CREDIT) { flow += p; continue; }
         if(InpMagic != 0 && HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic) { flow += p; continue; }
         flow += p; closed += p;
         if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN && (type == DEAL_TYPE_BUY || type == DEAL_TYPE_SELL)) trades++;
        }
     }
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   //--- open positions (to their stops)
   double vol[], en[], sl[], ts[], tv[]; int dir[]; ulong tickets[];
   int n = 0;
   double floating = 0.0;
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(InpMagic != 0 && PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      double t_s = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE), t_v = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
      if(t_v <= 0.0) t_v = t_s * SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE);
      ArrayResize(vol, n + 1); ArrayResize(en, n + 1); ArrayResize(sl, n + 1); ArrayResize(dir, n + 1); ArrayResize(ts, n + 1); ArrayResize(tv, n + 1); ArrayResize(tickets, n + 1);
      vol[n] = PositionGetDouble(POSITION_VOLUME); en[n] = PositionGetDouble(POSITION_PRICE_OPEN); sl[n] = PositionGetDouble(POSITION_SL);
      dir[n] = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1; ts[n] = t_s; tv[n] = t_v; tickets[n] = tk;
      floating += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      n++;
     }
   gDayStart = bal - flow; gClosed = closed; gFloat = floating; gTrades = trades;
   AT24DR_Snapshot(n, vol, en, sl, dir, ts, tv, gDayStart, closed, floating, trades, InpDailyLossPct, InpMaxTradePct, InpMaxOpenPct, InpMaxTrades, gRisk, gO);
   //--- remember what is broken right now
   for(int i = 0; i < n; i++)
     {
      if(sl[i] <= 0.0) NoteBreak("trade without stop loss", tickets[i], dayKey);
      else if(gDayStart > 0.0 && 100.0 * gRisk[i] / gDayStart > InpMaxTradePct + 1e-9) NoteBreak("trade risk above limit", tickets[i], dayKey);
     }
   if(gO[6] > 0.0) NoteBreak("too many trades today", 0, dayKey);
   if(gO[7] > 0.0) NoteBreak("open risk above limit", 0, dayKey);
   if(gO[8] > 0.0) NoteBreak("daily loss limit reached", 0, dayKey);
   gBreaksToday = CountBreaks(dayKey);
   B0[0] = gO[0]; B1[0] = gTrades; B2[0] = gO[3]; B3[0] = gBreaksToday; B4[0] = gO[1];
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 DAILY RISK PANEL", C'230,190,80', 10, true);
   if(!gLive)
     {
      MakeLabel("t2", 70, 26, "NO ACCOUNT CONNECTED", clrSlateGray, 11, true);
      MakeLabel("l1", 10, 66, "Connect to your broker account to see today's numbers.", clrSlateGray, 9);
      return;
     }
   double u = gO[0];
   color sc = u < 50.0 ? clrLimeGreen : (u < 80.0 ? clrGold : (u < 100.0 ? clrOrange : clrTomato));
   MakeLabel("t2", 70, 26, StringFormat("DAILY LOSS %.0f%% OF YOUR LIMIT", u), sc, 11, true);
   MakeRect("g1bg", 10, 52, 340, 8, C'30,44,66');
   MakeRect("g1", 10, 52, (int)(340.0 * MathMin(1.0, u / 100.0)), 8, sc);
   MakeLabel("l1", 10, 66, StringFormat("Day result %s   (limit -%s)", Money(gO[1]), Money(gDayStart * InpDailyLossPct / 100.0)), gO[1] < 0 ? clrOrange : clrWhite, 9);
   MakeLabel("l2", 10, 82, StringFormat("Trades opened today: %d of %s", gTrades, InpMaxTrades > 0 ? IntegerToString(InpMaxTrades) : "no limit"), gO[6] > 0 ? clrTomato : clrWhite, 9);
   MakeLabel("l3", 10, 98, StringFormat("Open risk to stops: %s = %.2f%% (limit %.1f%%)", Money(gO[2]), gO[3], InpMaxOpenPct), gO[7] > 0 ? clrTomato : clrWhite, 9);
   MakeLabel("l4", 10, 114, StringFormat("Positions without a stop: %d    above %.1f%% each: %d", (int)gO[4], InpMaxTradePct, (int)gO[5]), (gO[4] + gO[5]) > 0 ? clrTomato : clrWhite, 9);
   color bc = gBreaksToday == 0 ? clrLimeGreen : clrTomato;
   MakeLabel("h1", 10, 140, StringFormat("RULES BROKEN TODAY: %d", gBreaksToday), bc, 11, true);
   MakeLabel("l5", 10, 160, "Last: " + gLastBreak, clrSilver, 9);
   MakeLabel("l6", 10, 176, StringFormat("Day start balance %s   (resets %02d:00 broker time)", Money(gDayStart), InpResetHour), clrSlateGray, 8);
   MakeLabel("n1", 10, 198, "Counts each broken rule once per day. It only warns:", clrSlateGray, 8);
   MakeLabel("n2", 10, 212, "it never closes or blocks a trade.", clrSlateGray, 8);
   MakeLabel("f1", 10, 238, "Your own rules, tracked. Not a guarantee or advice.", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "Check your broker statement for the official figures. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Daily Risk Panel");
   if(InpDailyLossPct <= 0.0 || InpMaxTradePct <= 0.0 || InpMaxOpenPct <= 0.0 || InpMaxTrades < 0 || InpResetHour < 0 || InpResetHour > 23)
     {
      Print("AT24 Daily Risk Panel: limits must be above 0, max trades >= 0, reset hour 0-23.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gO, 10);
   for(int z = 0; z < 10; z++) gO[z] = 0.0;
   EventSetTimer(2);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

void OnTimer() { Reload(); Draw(); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 2) return 0;
   if(gAt == 0 || TimeCurrent() - gAt >= 2) { gAt = TimeCurrent(); Reload(); }
   Draw();
   return rates_total;
  }
