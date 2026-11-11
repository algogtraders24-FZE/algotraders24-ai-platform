//+------------------------------------------------------------------+
//| AT24 Edge Truth Test (MT5)                                       |
//| Is your result skill or luck? Reads the closed trades of this    |
//| account (optionally one symbol / one magic number) and tests the |
//| list against chance: sign-flip test, bootstrap range of the      |
//| total, drawdown against shuffled trade orders.                   |
//| Research tool. Not a signal. Past results do not predict.        |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Edge Truth Test - tests the closed-trade history of the account against luck (sign-flip, bootstrap, shuffled drawdown)."
#property description "It reads history only, places no trades and gives no signals."
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots   0

#include "AT24_TT_Core.mqh"

#resource "tt_logo56.bmp"

input group "=== Which trades ==="
input bool   InpThisSymbol    = false;  // Only trades on the chart symbol
input long   InpMagic         = -1;     // Only this magic number (-1 = all)
input int    InpDays          = 0;      // Only the last N days (0 = whole history)
input int    InpMinTrades     = 30;     // Trades needed before a verdict is shown
input bool   InpSampleData    = false;  // Use a built-in SAMPLE trade list (demonstration only, clearly labelled)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[], B2[];
string PFX = "AT24TT_";
bool   gDash = false, gSample = false;
int    gBaseX = 0, gBaseY = 0;
AT24TT_Res gR;
string gCur = "";
datetime gBuiltAt = 0;
int    gDeals = -1;

#define DASH_W 380
#define DASH_H 276

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

void BuildFrame()
  {
   CalcBase();
   string n = PFX + "bg";
   if(ObjectFind(0, n) < 0) ObjectCreate(0, n, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, n, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, n, OBJPROP_XDISTANCE, gBaseX);
   ObjectSetInteger(0, n, OBJPROP_YDISTANCE, gBaseY);
   ObjectSetInteger(0, n, OBJPROP_XSIZE, DASH_W);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, DASH_H);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'12,22,40');
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, C'200,160,60');
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, false);
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::tt_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 EDGE TRUTH TEST", C'230,190,80', 10, true);
   if(gSample) MakeLabel("smp", 70, 58, "SAMPLE DATA - NOT YOUR TRADES", clrTomato, 8, true);
   else MakeLabel("smp", 70, 58, " ", clrTomato, 8, true);
   if(gR.n < 2)
     {
      MakeLabel("t2", 70, 26, "NO CLOSED TRADES FOUND", clrSlateGray, 11, true);
      MakeLabel("t3", 70, 42, "Check the filters, or load the account history (Account History tab).", clrSilver, 8);
      return;
     }
   string v; color vc;
   if(gR.n < InpMinTrades) { v = StringFormat("TOO FEW TRADES (%d of %d)", gR.n, InpMinTrades); vc = clrSlateGray; }
   else if(gR.pFlip < 0.05 && gR.pLoss < 0.05) { v = "UNLIKELY TO BE PURE LUCK"; vc = clrLimeGreen; }
   else if(gR.pFlip > 0.95 && gR.pLoss > 0.95) { v = "LOSING BEYOND CHANCE"; vc = clrTomato; }
   else { v = "CANNOT BE TOLD FROM LUCK"; vc = clrGold; }
   MakeLabel("t2", 70, 26, v, vc, 11, true);
   MakeLabel("t3", 70, 42, StringFormat("%d trades  win %.0f %%  total %+.2f %s  avg %+.2f  PF %.2f", gR.n, 100.0 * gR.wins / gR.n, gR.total, gCur, gR.mean, gR.pf), clrWhite, 8, true);
   MakeLabel("a1", 10, 74, "Is the profit more than chance?", C'230,190,80', 8, true);
   MakeLabel("a2", 10, 88, StringFormat("t-statistic %+.2f   sign-flip p = %.3f  (< 0.05: unlikely luck)", gR.t, gR.pFlip), clrWhite, 8);
   MakeLabel("b1", 10, 112, "Where could the total end up with the same trades?", C'230,190,80', 8, true);
   MakeLabel("b2", 10, 126, StringFormat("90 %% range %+.0f to %+.0f %s   chance of a loss %.0f %%", gR.bootLo, gR.bootHi, gCur, 100.0 * gR.pLoss), gR.bootLo > 0.0 ? clrLimeGreen : (gR.bootHi < 0.0 ? clrTomato : clrWhite), 8);
   MakeLabel("c1", 10, 150, "Was the drawdown bad luck or normal?", C'230,190,80', 8, true);
   MakeLabel("c2", 10, 164, StringFormat("max drawdown %.0f %s; typical for this list %.0f %s", gR.maxDD, gCur, gR.ddMedian, gCur), clrWhite, 8);
   MakeLabel("c3", 10, 178, StringFormat("worse than %.0f %% of the shuffled orders", 100.0 * gR.ddRank), clrSilver, 8);
   MakeLabel("n1", 10, 202, "A pass says luck alone is unlikely for THIS list.", clrSlateGray, 8);
   MakeLabel("n2", 10, 216, "It is not proof of a lasting edge: markets change.", clrSlateGray, 8);
   MakeLabel("n3", 10, 230, "Re-check as new trades arrive. Under 30: no verdict.", clrSlateGray, 8);
   MakeLabel("f1", 10, 254, "History-only research tool, not a signal or advice.", clrSlateGray, 7);
   MakeLabel("f2", 10, 265, "5000 flips, 2000 bootstraps, 2000 shuffles. algotraders24.ai", clrSlateGray, 7);
  }

void SampleList(double &p[], int &n)
  {
   n = 90; ArrayResize(p, n);
   uint s = 777;
   for(int i = 0; i < n; i++) p[i] = ((double)((int)(AT24TT_Next(s) % 2001) - 1000)) / 10.0 + 9.0;
  }

bool Rebuild()
  {
   double p[]; int n = 0;
   if(InpSampleData) { SampleList(p, n); gCur = "USD"; gSample = true; }
   else
     {
      gSample = false;
      datetime from = InpDays > 0 ? TimeCurrent() - (datetime)((long)InpDays * 86400) : 0;
      if(!HistorySelect(from, TimeCurrent() + 86400)) return false;
      int total = HistoryDealsTotal();
      ArrayResize(p, total);
      for(int i = 0; i < total; i++)
        {
         ulong tk = HistoryDealGetTicket(i);
         if(tk == 0) continue;
         long type = HistoryDealGetInteger(tk, DEAL_TYPE);
         long entry = HistoryDealGetInteger(tk, DEAL_ENTRY);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
         if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT) continue;
         if(InpThisSymbol && HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
         if(InpMagic >= 0 && HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic) continue;
         p[n++] = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_FEE);
        }
      gCur = AccountInfoString(ACCOUNT_CURRENCY);
     }
   gDeals = n;
   AT24TT_Run(p, n, 20261111, gR);
   B0[0] = gR.n; B1[0] = gR.pFlip; B2[0] = gR.total;
   return true;
  }

void Refresh()
  {
   datetime hourNow = (datetime)(((long)TimeCurrent() / 3600) * 3600);
   if(gBuiltAt != hourNow) { if(Rebuild()) gBuiltAt = hourNow; }
  }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS); SetIndexBuffer(2, B2, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true); ArraySetAsSeries(B2, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Edge Truth Test");
   if(InpMinTrades < 10 || InpDays < 0)
     {
      Print("AT24 Edge Truth Test: at least 10 trades per verdict, days >= 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   gR.n = 0;
   EventSetTimer(30);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

void OnTimer()
  {
   //--- rebuild when a new closed deal appears (cheap check), otherwise hourly
   if(HistorySelect(0, TimeCurrent() + 86400) && HistoryDealsTotal() != gDeals && !InpSampleData) gBuiltAt = 0;
   Refresh(); Draw();
  }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 2) return 0;
   Refresh();
   Draw();
   return rates_total;
  }
