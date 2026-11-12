//+------------------------------------------------------------------+
//| AT24 Trade Autopsy (MT5)                                         |
//| Where did your exits leave money on the table? Reads the closed  |
//| trades of this account on the chart symbol, draws them on the    |
//| chart and measures how much of the best price each trade reached |
//| the exit captured, how much heat the winners took, and what      |
//| price did right after the exit.                                  |
//| Descriptive, hindsight statistics. Not a signal.                 |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Trade Autopsy - draws your closed trades and shows how much of each trade's best price the exit captured, winner heat and post-exit moves."
#property description "It reads history only, places no trades and gives no signals."
#property indicator_chart_window
#property indicator_buffers 3
#property indicator_plots   0

#include "AT24_TA_Core.mqh"

#resource "ta_logo56.bmp"

input group "=== Which trades ==="
input bool   InpThisSymbol    = true;          // Only trades on the chart symbol
input long   InpMagic         = -1;            // Only this magic number (-1 = all)
input int    InpDays          = 0;             // Only the last N days (0 = whole history)
input ENUM_TIMEFRAMES InpTf   = PERIOD_M15;    // Bars used to measure the path of each trade
input int    InpPostBars      = 16;            // Bars after the exit to look at
input int    InpMinTrades     = 20;            // Trades needed before the headline is shown
input int    InpDrawTrades    = 30;            // Draw the last N trades on the chart (0 = none)
input bool   InpSampleData    = false;         // Use built-in SAMPLE trades on the chart bars (demonstration only, clearly labelled)
input group "=== Dashboard ==="
input bool   InpShowDash      = true;          // Show dashboard
input bool   InpDashInTester  = false;         // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;            // Dashboard X offset
input int    InpDashY         = 24;            // Dashboard Y offset

double B0[], B1[], B2[];
string PFX = "AT24TA_";
bool   gDash = false, gSample = false;
int    gBaseX = 0, gBaseY = 0, gDeals = -1;
AT24TA_Sum gS;
AT24TA_Trade gTr[];
int    gM = 0;
datetime gBuiltAt = 0;

#define DASH_W 390
#define DASH_H 292

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
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ta_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

void DrawTrades()
  {
   ObjectsDeleteAll(0, PFX + "tr");
   if(InpDrawTrades <= 0) return;
   int from = MathMax(0, gM - InpDrawTrades);
   for(int k = from; k < gM; k++)
     {
      bool win = gTr[k].dir * (gTr[k].pOut - gTr[k].pIn) > 0.0;
      color c = win ? clrLimeGreen : clrTomato;
      string n = PFX + "tr" + IntegerToString(k);
      ObjectCreate(0, n, OBJ_TREND, 0, gTr[k].tIn, gTr[k].pIn, gTr[k].tOut, gTr[k].pOut);
      ObjectSetInteger(0, n, OBJPROP_COLOR, c);
      ObjectSetInteger(0, n, OBJPROP_WIDTH, 2);
      ObjectSetInteger(0, n, OBJPROP_STYLE, STYLE_DOT);
      ObjectSetInteger(0, n, OBJPROP_RAY_RIGHT, false);
      ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
     }
  }

void Draw()
  {
   if(!gDash) return;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 TRADE AUTOPSY", C'230,190,80', 10, true);
   MakeLabel("smp", 70, 58, gSample ? "SAMPLE TRADES - NOT YOURS" : " ", clrTomato, 8, true);
   if(gS.n < 1)
     {
      MakeLabel("t2", 70, 26, "NO CLOSED TRADES FOUND", clrSlateGray, 11, true);
      MakeLabel("t3", 70, 42, "Check the filters, or load the account history.", clrSilver, 8);
      return;
     }
   if(gS.n < InpMinTrades)
     {
      MakeLabel("t2", 70, 26, StringFormat("TOO FEW TRADES (%d of %d)", gS.n, InpMinTrades), clrSlateGray, 11, true);
      MakeLabel("t3", 70, 42, StringFormat("%d winners, %d losers on %s", gS.winners, gS.losers, _Symbol), clrSilver, 8);
      return;
     }
   color vc = gS.captureWin >= 0.6 ? clrLimeGreen : (gS.captureWin >= 0.4 ? clrGold : clrTomato);
   MakeLabel("t2", 70, 26, StringFormat("Winners keep %.0f %% of the best price", 100.0 * gS.captureWin), vc, 11, true);
   MakeLabel("t3", 70, 42, StringFormat("%d trades on %s: %d winners, %d losers", gS.n, _Symbol, gS.winners, gS.losers), clrWhite, 8, true);
   MakeLabel("a1", 10, 78, "Exits", C'230,190,80', 8, true);
   MakeLabel("a2", 10, 92, StringFormat("%.0f %% of winners: price went at least as far again within %d bars", gS.earlyPct, InpPostBars), clrWhite, 8);
   MakeLabel("a3", 10, 106, StringFormat("%.0f %% of trades closed with under half of their best price", gS.giveBackPct), clrWhite, 8);
   MakeLabel("b1", 10, 130, "Pain", C'230,190,80', 8, true);
   MakeLabel("b2", 10, 144, StringFormat("winners dipped on average %.0f %% of their best run against you", gS.avgMaePct), clrWhite, 8);
   MakeLabel("b3", 10, 158, StringFormat("%.0f %% of losers: price got back to your entry within %d bars", gS.recoverPct, InpPostBars), clrWhite, 8);
   MakeLabel("c1", 10, 182, "Risk", C'230,190,80', 8, true);
   if(gS.withStop > 0) MakeLabel("c2", 10, 196, StringFormat("average result %+.2f R over %d trades that had a stop", gS.avgR, gS.withStop), clrWhite, 8);
   else MakeLabel("c2", 10, 196, "no trade had a stop-loss set at entry", clrTomato, 8);
   MakeLabel("n1", 10, 222, "Hindsight statistics: they show what price did, not", clrSlateGray, 8);
   MakeLabel("n2", 10, 236, "what you could have done. Path measured on bars.", clrSlateGray, 8);
   MakeLabel("f1", 10, 262, "History-only research tool, not a signal or advice.", clrSlateGray, 7);
   MakeLabel("f2", 10, 273, StringFormat("%s bars, %d bars after exit. algotraders24.ai", StringSubstr(EnumToString(InpTf), 7), InpPostBars), clrSlateGray, 7);
  }

//--- built-in sample: deterministic trades on the chart bars (demonstration only)
uint Nx(uint &s) { s ^= (s << 13); s ^= (s >> 17); s ^= (s << 5); return s; }
void SampleTrades(const int n, const datetime &t[], const double &o[], const double &c[])
  {
   gM = 0; ArrayResize(gTr, 60);
   uint s = 20261117;
   for(int k = 0; k < 60 && n > 400; k++)
     {
      int i0 = n - 450 + (int)(Nx(s) % 400); int len = 1 + (int)(Nx(s) % 30);
      int dir = ((Nx(s) >> 8) & 1) == 1 ? 1 : -1; double slDist = 3.0 + (double)(Nx(s) % 90) / 10.0;
      gTr[gM].dir = dir; gTr[gM].tIn = t[i0]; gTr[gM].tOut = t[i0 + len]; gTr[gM].pIn = o[i0]; gTr[gM].pOut = c[i0 + len];
      gTr[gM].sl = dir > 0 ? o[i0] - slDist : o[i0] + slDist; gTr[gM].profit = 0.0; gM++;
     }
   for(int i = 1; i < gM; i++) { AT24TA_Trade x = gTr[i]; int j = i - 1; while(j >= 0 && gTr[j].tOut > x.tOut) { gTr[j + 1] = gTr[j]; j--; } gTr[j + 1] = x; }
  }

bool Rebuild()
  {
   MqlRates rr[];
   int n = CopyRates(_Symbol, InpTf, 1, 60000, rr);
   if(n < 500) return false;
   datetime t[]; double h[], l[], o[], c[];
   ArrayResize(t, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(o, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { t[i] = rr[i].time; h[i] = rr[i].high; l[i] = rr[i].low; o[i] = rr[i].open; c[i] = rr[i].close; }
   if(InpSampleData) { gSample = true; SampleTrades(n, t, o, c); }
   else
     {
      gSample = false; gM = 0;
      datetime from = InpDays > 0 ? TimeCurrent() - (datetime)((long)InpDays * 86400) : 0;
      if(!HistorySelect(from, TimeCurrent() + 86400)) return false;
      int total = HistoryDealsTotal(); gDeals = total;
      //--- positions: first IN deal + all OUT deals of the same position id
      ulong ids[]; ArrayResize(ids, 0);
      for(int i = 0; i < total; i++)
        {
         ulong tk = HistoryDealGetTicket(i); if(tk == 0) continue;
         long type = HistoryDealGetInteger(tk, DEAL_TYPE), entry = HistoryDealGetInteger(tk, DEAL_ENTRY);
         if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL) continue;
         if(entry != DEAL_ENTRY_IN) continue;
         if(InpThisSymbol && HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
         if(InpMagic >= 0 && HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic) continue;
         int k = ArraySize(ids); ArrayResize(ids, k + 1); ids[k] = (ulong)HistoryDealGetInteger(tk, DEAL_POSITION_ID);
        }
      ArrayResize(gTr, ArraySize(ids));
      for(int k = 0; k < ArraySize(ids); k++)
        {
         if(!HistorySelectByPosition(ids[k])) continue;
         int dn = HistoryDealsTotal(); datetime tIn = 0, tOut = 0; double pIn = 0, volIn = 0, vOut = 0, pxOut = 0, prof = 0; int dir = 0; ulong inOrder = 0; bool closed = false;
         for(int j = 0; j < dn; j++)
           {
            ulong tk = HistoryDealGetTicket(j); if(tk == 0) continue;
            long entry = HistoryDealGetInteger(tk, DEAL_ENTRY), type = HistoryDealGetInteger(tk, DEAL_TYPE);
            prof += HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_FEE);
            if(entry == DEAL_ENTRY_IN && tIn == 0) { tIn = (datetime)HistoryDealGetInteger(tk, DEAL_TIME); pIn = HistoryDealGetDouble(tk, DEAL_PRICE); volIn = HistoryDealGetDouble(tk, DEAL_VOLUME); dir = (type == DEAL_TYPE_BUY) ? 1 : -1; inOrder = (ulong)HistoryDealGetInteger(tk, DEAL_ORDER); }
            else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY) { double v = HistoryDealGetDouble(tk, DEAL_VOLUME); pxOut += v * HistoryDealGetDouble(tk, DEAL_PRICE); vOut += v; tOut = (datetime)HistoryDealGetInteger(tk, DEAL_TIME); closed = true; }
           }
         if(!closed || tIn == 0 || vOut <= 0.0) continue;
         double sl = 0.0;
         if(HistoryOrderSelect(inOrder)) sl = HistoryOrderGetDouble(inOrder, ORDER_SL);
         gTr[gM].dir = dir; gTr[gM].tIn = tIn; gTr[gM].tOut = tOut; gTr[gM].pIn = pIn; gTr[gM].pOut = pxOut / vOut; gTr[gM].sl = sl; gTr[gM].profit = prof; gM++;
        }
      //--- chronological order by exit time (insertion sort, lists are short)
      for(int i = 1; i < gM; i++) { AT24TA_Trade x = gTr[i]; int j = i - 1; while(j >= 0 && gTr[j].tOut > x.tOut) { gTr[j + 1] = gTr[j]; j--; } gTr[j + 1] = x; }
     }
   AT24TA_Analyze(gTr, gM, n, t, h, l, PeriodSeconds(InpTf), InpPostBars, gS);
   B0[0] = gS.n; B1[0] = gS.captureWin; B2[0] = gS.avgR;
   DrawTrades();
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
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Trade Autopsy");
   if(InpPostBars < 1 || InpPostBars > 200 || InpMinTrades < 5 || InpDays < 0 || InpDrawTrades < 0)
     {
      Print("AT24 Trade Autopsy: post-exit bars 1-200, at least 5 trades for the headline, days >= 0.");
      return INIT_PARAMETERS_INCORRECT;
     }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   gS.n = 0;
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
   if(!InpSampleData && HistorySelect(0, TimeCurrent() + 86400) && HistoryDealsTotal() != gDeals) gBuiltAt = 0;
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
