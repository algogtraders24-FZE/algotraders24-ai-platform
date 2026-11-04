//+------------------------------------------------------------------+
//| AT24 Drawdown & Recovery (MT5)                                   |
//| How far below its peak your account is, the gain needed to get   |
//| back, and how few losses in a row it takes to dig a hole.        |
//| Calculator + account tracker. Not a signal. Not advice.          |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Drawdown & Recovery - current and maximum drawdown from your deal history, gain needed to recover, losing-streak table."
#property description "Maths on your own account history. It never places trades."
#property indicator_chart_window
#property indicator_buffers 5
#property indicator_plots   0

#include "AT24_DD_Core.mqh"

#resource "dd_logo56.bmp"

input group "=== Account ==="
input long   InpMagic         = 0;      // Only deals with this magic number (0 = whole account)
input double InpRiskPct       = 1.0;    // Your usual risk per trade, % (for the losing-streak table)
input double InpDemoBase      = 10000.0;// Starting balance used when no account is connected
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[], B3[], B4[];
string PFX = "AT24DD_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0;
datetime gHistAt = 0;
double gOut[];
bool   gLive = false;

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::dd_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string Money(const double v) { return StringFormat("%s %s", DoubleToString(v, 2), AccountInfoString(ACCOUNT_CURRENCY)); }

//--- rebuild the performance curve from the deal history (balance operations are treated as deposits made at the start)
void Reload()
  {
   gLive = (AccountInfoInteger(ACCOUNT_LOGIN) != 0 && AccountInfoDouble(ACCOUNT_BALANCE) > 0.0);
   double pnl[]; int n = 0; ArrayResize(pnl, 0);
   double sum = 0.0;
   if(gLive && HistorySelect(0, TimeCurrent() + 86400))
     {
      int total = HistoryDealsTotal();
      for(int i = 0; i < total; i++)
        {
         ulong tk = HistoryDealGetTicket(i);
         if(tk == 0) continue;
         long type = HistoryDealGetInteger(tk, DEAL_TYPE);
         if(type == DEAL_TYPE_BALANCE || type == DEAL_TYPE_CREDIT) continue;
         if(InpMagic != 0 && HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic) continue;
         double p = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_FEE);
         if(p == 0.0) continue;                   // opening deals without cost carry no result
         ArrayResize(pnl, n + 1); pnl[n] = p; n++; sum += p;
        }
     }
   double bal = gLive ? AccountInfoDouble(ACCOUNT_BALANCE) : InpDemoBase;
   double floating = gLive ? AccountInfoDouble(ACCOUNT_EQUITY) - bal : 0.0;
   double base = bal - sum;                       // net deposits: balance now minus all trading results
   if(InpMagic != 0) base = bal - sum;            // magic filter: the other results stay inside the base
   AT24DD_Analyze(n, pnl, base, floating, gOut);
   B0[0] = gOut[2]; B1[0] = gOut[1]; B2[0] = gOut[3]; B3[0] = gOut[0]; B4[0] = gOut[4];
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 DRAWDOWN & RECOVERY", C'230,190,80', 10, true);
   double cdd = gOut[2];
   color sc = cdd < 5.0 ? clrLimeGreen : (cdd < 10.0 ? clrGold : (cdd < 20.0 ? clrOrange : clrTomato));
   MakeLabel("t2", 70, 26, StringFormat("%.1f%% BELOW PEAK", cdd), sc, 11, true);
   MakeRect("g1bg", 10, 52, 340, 8, C'30,44,66');
   MakeRect("g1", 10, 52, (int)(340.0 * MathMin(1.0, cdd / 50.0)), 8, sc);
   MakeLabel("l1", 10, 66, StringFormat("Equity %s   peak %s", Money(gOut[4]), Money(gOut[0])), clrWhite, 9);
   MakeLabel("l2", 10, 82, StringFormat("To get back to the peak you need +%.1f%%", gOut[3]), clrWhite, 9);
   MakeLabel("l3", 10, 98, StringFormat("Worst drawdown on record: %.1f%% (needs +%.1f%%)", gOut[1], gOut[5]), clrWhite, 9);
   MakeLabel("l4", 10, 114, gLive ? StringFormat("%d results since the peak, %d deals used", (int)gOut[6], (int)gOut[7]) : "No account connected: showing the formulas only.", gLive ? clrSlateGray : clrOrange, 8);
   MakeLabel("h1", 10, 134, "Gain needed to recover a drawdown", C'230,190,80', 9, true);
   double d[5] = {10, 20, 30, 50, 75};
   string row = "";
   for(int i = 0; i < 5; i++) row += StringFormat("-%.0f%% needs +%.0f%%   ", d[i], AT24DD_Recovery(d[i]));
   MakeLabel("r1", 10, 150, StringFormat("-10%%: +%.1f%%   -20%%: +%.1f%%   -30%%: +%.1f%%", AT24DD_Recovery(10), AT24DD_Recovery(20), AT24DD_Recovery(30)), clrWhite, 9);
   MakeLabel("r2", 10, 166, StringFormat("-50%%: +%.1f%%   -75%%: +%.1f%%   -90%%: +%.1f%%", AT24DD_Recovery(50), AT24DD_Recovery(75), AT24DD_Recovery(90)), clrWhite, 9);
   MakeLabel("h2", 10, 186, StringFormat("Losing streak at %.1f%% risk per trade", InpRiskPct), C'230,190,80', 9, true);
   MakeLabel("s1", 10, 202, StringFormat("5 losses: -%.1f%%   10: -%.1f%%   20: -%.1f%%", AT24DD_Streak(InpRiskPct, 5), AT24DD_Streak(InpRiskPct, 10), AT24DD_Streak(InpRiskPct, 20)), clrWhite, 9);
   MakeLabel("s2", 10, 218, StringFormat("Losses in a row to reach -10%%: %d   -20%%: %d", AT24DD_LossesTo(InpRiskPct, 10.0), AT24DD_LossesTo(InpRiskPct, 20.0)), clrWhite, 9);
   MakeLabel("f1", 10, 238, "Arithmetic on your own history, not a forecast. Deposits are", clrSlateGray, 7);
   MakeLabel("f2", 10, 250, "assumed made at the start. Not advice. algotraders24.ai", clrSlateGray, 7);
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   SetIndexBuffer(3, B3, INDICATOR_CALCULATIONS); SetIndexBuffer(4, B4, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true); ArraySetAsSeries(B3, true); ArraySetAsSeries(B4, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Drawdown & Recovery");
   if(InpRiskPct <= 0.0 || InpRiskPct >= 100.0 || InpDemoBase <= 0.0)
     {
      Print("AT24 Drawdown & Recovery: risk % must be between 0 and 100, demo base above 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   ArrayResize(gOut, 8);
   for(int z = 0; z < 8; z++) gOut[z] = 0.0;
   EventSetTimer(5);
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
   if(gHistAt == 0 || TimeCurrent() - gHistAt >= 5) { gHistAt = TimeCurrent(); Reload(); }
   Draw();
   return rates_total;
  }
