//+------------------------------------------------------------------+
//| AT24 Setup Scanner (MT5)                                         |
//| One panel for a watchlist: which symbols have a setup on the     |
//| last closed bar (with entry, stop, target) and what each setup   |
//| type has done on that symbol's own history. With a reminder of   |
//| how many "passes" pure chance would give across the list.        |
//| Research and planning tool. Not a promise of results.            |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#property copyright "AlgoTraders24"
#property link      "https://algotraders24.ai"
#property version   "1.00"
#property description "AT24 Setup Scanner - watchlist table of live setups with levels and per-symbol scorecards, plus an honest chance-passes reminder."
#property description "It places no trades. Results on past bars do not predict future results. Not financial advice."
#property indicator_chart_window
#property indicator_buffers 2
#property indicator_plots   0

#include "AT24_SS_Engine.mqh"

#resource "ss_logo56.bmp"

input group "=== Watchlist ==="
input string InpSymbols       = "XAUUSD,EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,US500,BTCUSD"; // Symbols, comma separated, exactly as your broker names them (max 20)
input ENUM_TIMEFRAMES InpTf   = PERIOD_H1;     // Timeframe scanned
input group "=== Setups ==="
input bool   InpPullback      = true;   // Trend pullback setups
input bool   InpSqueeze       = true;   // Squeeze release setups
input double InpStopAtr       = 1.5;    // Stop distance in ATR(14) of the signal bar
input double InpRewardRisk    = 2.0;    // Target as a multiple of the stop distance
input int    InpMaxHold       = 40;     // Bars before a trade is closed at the market (timed exit)
input double InpCost          = 0.0;    // Round-turn cost in price units (0 = each symbol's current spread)
input int    InpHistoryBars   = 6000;   // Bars analysed per symbol
input group "=== Alerts (bar close) ==="
input bool   InpAlertNew      = false;  // Alert when a new setup forms on any symbol
input bool   InpAlertPush     = false;  // Also send a push notification
input group "=== Dashboard ==="
input bool   InpShowDash      = true;   // Show dashboard
input bool   InpDashInTester  = false;  // Show dashboard in Strategy Tester
input ENUM_BASE_CORNER InpCorner = CORNER_LEFT_UPPER; // Dashboard corner
input int    InpDashX         = 12;     // Dashboard X offset
input int    InpDashY         = 24;     // Dashboard Y offset

double B0[], B1[];
string PFX = "AT24SS_";
bool   gDash = false;
int    gBaseX = 0, gBaseY = 0, gW = 660, gH = 200;
AT24SS_Row gRows[];
string gList[];
int    gNs = 0;
datetime gBuiltBar = 0, gBuiltAt = 0;
datetime gAlerted[];

void CalcBase()
  {
   bool right = (InpCorner == CORNER_RIGHT_UPPER || InpCorner == CORNER_RIGHT_LOWER);
   bool lower = (InpCorner == CORNER_LEFT_LOWER || InpCorner == CORNER_RIGHT_LOWER);
   int w = (int)ChartGetInteger(0, CHART_WIDTH_IN_PIXELS);
   int h = (int)ChartGetInteger(0, CHART_HEIGHT_IN_PIXELS, 0);
   gBaseX = right ? MathMax(0, w - gW - InpDashX) : InpDashX;
   gBaseY = lower ? MathMax(0, h - gH - InpDashY) : InpDashY;
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
   ObjectSetInteger(0, n, OBJPROP_XSIZE, gW);
   ObjectSetInteger(0, n, OBJPROP_YSIZE, gH);
   ObjectSetInteger(0, n, OBJPROP_BGCOLOR, C'12,22,40');
   ObjectSetInteger(0, n, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, n, OBJPROP_COLOR, C'200,160,60');
   ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
   ObjectSetInteger(0, n, OBJPROP_BACK, false);
   string lg = PFX + "logo";
   if(ObjectFind(0, lg) < 0) ObjectCreate(0, lg, OBJ_BITMAP_LABEL, 0, 0, 0);
   ObjectSetString(0, lg, OBJPROP_BMPFILE, "::ss_logo56.bmp");
   ObjectSetInteger(0, lg, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_ANCHOR, ANCHOR_LEFT_UPPER);
   ObjectSetInteger(0, lg, OBJPROP_XDISTANCE, gBaseX + 6);
   ObjectSetInteger(0, lg, OBJPROP_YDISTANCE, gBaseY + 6);
   ObjectSetInteger(0, lg, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, lg, OBJPROP_HIDDEN, true);
  }

string TrendTxt(const int t) { return t > 0 ? "UP" : (t < 0 ? "DOWN" : "RANGE"); }
color  TrendCol(const int t) { return t > 0 ? clrLimeGreen : (t < 0 ? clrTomato : clrSlateGray); }

//--- 1 positive beyond luck, -1 negative beyond luck, 0 no edge shown, 2 too few
int Verdict(const AT24SP_Score &s)
  {
   if(s.n < 30) return 2;
   if(s.avgR > 0.0 && s.pFlip < 0.05) return 1;
   if(s.avgR < 0.0 && s.pFlip > 0.95) return -1;
   return 0;
  }

string ScoreTxt(const AT24SP_Score &s, color &c)
  {
   int v = Verdict(s);
   if(v == 2) { c = clrSlateGray; return StringFormat("n=%d (too few)", s.n); }
   if(v == 1) { c = clrLimeGreen; return StringFormat("%d  %+.2fR  p%.2f  PASS", s.n, s.avgR, s.pFlip); }
   if(v == -1) { c = clrTomato; return StringFormat("%d  %+.2fR  NEGATIVE", s.n, s.avgR); }
   c = clrSilver; return StringFormat("%d  %+.2fR  none", s.n, s.avgR);
  }

void Draw()
  {
   if(!gDash) return;
   int rowsN = gNs;
   gH = 124 + rowsN * 18 + 80;
   BuildFrame();
   MakeLabel("t1", 70, 6, "AT24 SETUP SCANNER", C'230,190,80', 10, true);
   int live = 0, cells = 0, pass = 0, okRows = 0;
   for(int i = 0; i < gNs; i++) { if(!gRows[i].ok) continue; okRows++; if(gRows[i].active >= 0) live++; for(int ty = 0; ty < 2; ty++) { bool on = (ty == 0) ? InpPullback : InpSqueeze; if(!on) continue; int v = Verdict(gRows[i].sc[ty]); if(v != 2) cells++; if(v == 1) pass++; } }
   MakeLabel("t2", 70, 26, StringFormat("%d of %d symbols have a setup on the last closed bar", live, okRows), live > 0 ? clrLimeGreen : clrSlateGray, 10, true);
   MakeLabel("t3", 70, 42, StringFormat("%s, stop %.1f ATR, target %.1f R, timed exit %d bars", StringSubstr(EnumToString(InpTf), 7), InpStopAtr, InpRewardRisk, InpMaxHold), clrSilver, 8);
   MakeLabel("h0", 10, 70, "Symbol", clrSlateGray, 8, true);
   MakeLabel("h1", 90, 70, "Trend", clrSlateGray, 8, true);
   MakeLabel("h2", 150, 70, "Setup now (entry ~ / stop / target)", clrSlateGray, 8, true);
   MakeLabel("h3", 400, 70, "Pullback on history", clrSlateGray, 8, true);
   MakeLabel("h4", 530, 70, "Squeeze on history", clrSlateGray, 8, true);
   //--- order: live setups first, then the list order
   int ord[]; ArrayResize(ord, gNs); int q = 0;
   for(int i = 0; i < gNs; i++) if(gRows[i].ok && gRows[i].active >= 0) ord[q++] = i;
   for(int i = 0; i < gNs; i++) if(!(gRows[i].ok && gRows[i].active >= 0)) ord[q++] = i;
   for(int k = 0; k < gNs; k++)
     {
      AT24SS_Row r = gRows[ord[k]]; int y = 88 + k * 18; string id = IntegerToString(k);
      MakeLabel("r0" + id, 10, y, gList[ord[k]], r.ok ? clrWhite : clrTomato, 9, true);
      if(!r.ok) { MakeLabel("r1" + id, 90, y, "no data / symbol not found", clrTomato, 8); MakeLabel("r2" + id, 150, y, " ", clrWhite, 8); MakeLabel("r3" + id, 400, y, " ", clrWhite, 8); MakeLabel("r4" + id, 530, y, " ", clrWhite, 8); continue; }
      MakeLabel("r1" + id, 90, y, TrendTxt(r.trend), TrendCol(r.trend), 8, true);
      if(r.active >= 0) MakeLabel("r2" + id, 150, y, StringFormat("%s %s  %s / %s / %s", r.actDir > 0 ? "LONG" : "SHORT", r.active == 0 ? "pullback" : "squeeze", DoubleToString(r.actEntry, r.digits), DoubleToString(r.actSl, r.digits), DoubleToString(r.actTp, r.digits)), r.actDir > 0 ? clrLimeGreen : clrTomato, 8, true);
      else MakeLabel("r2" + id, 150, y, "-", clrSlateGray, 8);
      color c0 = clrSlateGray, c1 = clrSlateGray;
      string s0 = InpPullback ? ScoreTxt(r.sc[0], c0) : "off";      // text first: MQL5 evaluates call arguments right to left
      string s1 = InpSqueeze ? ScoreTxt(r.sc[1], c1) : "off";
      MakeLabel("r3" + id, 400, y, s0, c0, 8);
      MakeLabel("r4" + id, 530, y, s1, c1, 8);
     }
   int y2 = 88 + gNs * 18 + 8;
   MakeLabel("c1", 10, y2, StringFormat("%d of %d scorecards beat luck (p<0.05); chance alone gives ~%.1f", pass, cells, 0.05 * cells), pass > 0.05 * cells + 1.0 ? clrGold : clrSilver, 8, true);
   MakeLabel("c2", 10, y2 + 15, "A PASS is a lead to re-check on new data, not a promise.", clrSlateGray, 8);
   MakeLabel("c3", 10, y2 + 29, "Closed bars only (no repainting). Past results do not", clrSlateGray, 8);
   MakeLabel("c4", 10, y2 + 43, "predict future results.", clrSlateGray, 8);
   MakeLabel("f1", 10, y2 + 62, "Research tool, not a signal or advice. algotraders24.ai", clrSlateGray, 7);
  }

bool Rebuild(const bool onlyMissing)
  {
   bool any = false;
   for(int i = 0; i < gNs; i++)
     {
      if(onlyMissing && gRows[i].ok) { any = true; continue; }
      AT24SS_Work w;
      AT24SS_Row row;
      if(AT24SS_Analyze(gList[i], InpTf, InpHistoryBars, InpPullback, InpSqueeze, InpStopAtr, InpRewardRisk, InpMaxHold, InpCost, row, w)) any = true;
      gRows[i] = row;
     }
   int live = 0; for(int i = 0; i < gNs; i++) if(gRows[i].ok && gRows[i].active >= 0) live++;
   B0[0] = live; B1[0] = gNs;
   return any;
  }

void Refresh()
  {
   datetime bar = iTime(_Symbol, InpTf, 0);
   if(bar == 0) return;
   bool allOk = AllOk();
   bool stale = (gBuiltBar != bar) || (!allOk && TimeCurrent() - gBuiltAt >= 10);   // other symbols load their history in the background: retry until every row has data
   if(!stale) return;
   if(Rebuild(gBuiltBar == bar)) { gBuiltBar = bar; }
   gBuiltAt = TimeCurrent();
   if(gBuiltBar == bar && InpAlertNew)
      for(int i = 0; i < gNs; i++)
        {
         if(!gRows[i].ok || gRows[i].active < 0 || gAlerted[i] == gRows[i].lastBar) continue;
         gAlerted[i] = gRows[i].lastBar;
         string msg = StringFormat("AT24 Setup Scanner %s %s: %s %s setup, entry ~%s stop %s target %s", gList[i], EnumToString(InpTf), gRows[i].actDir > 0 ? "LONG" : "SHORT", gRows[i].active == 0 ? "pullback" : "squeeze",
                                   DoubleToString(gRows[i].actEntry, gRows[i].digits), DoubleToString(gRows[i].actSl, gRows[i].digits), DoubleToString(gRows[i].actTp, gRows[i].digits));
         Alert(msg);
         if(InpAlertPush) SendNotification(msg);
        }
  }

bool AllOk() { for(int i = 0; i < gNs; i++) if(!gRows[i].ok) return false; return true; }

int OnInit()
  {
   SetIndexBuffer(0, B0, INDICATOR_CALCULATIONS); SetIndexBuffer(1, B1, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(B0, true); ArraySetAsSeries(B1, true);
   IndicatorSetString(INDICATOR_SHORTNAME, "AT24 Setup Scanner");
   if(InpStopAtr < 0.3 || InpStopAtr > 10.0 || InpRewardRisk < 0.3 || InpRewardRisk > 10.0 || InpMaxHold < 5 || InpMaxHold > 500 || InpCost < 0.0 || InpHistoryBars < 1000)
     {
      Print("AT24 Setup Scanner: stop 0.3-10 ATR, reward:risk 0.3-10, hold 5-500 bars, cost >= 0, history >= 1000 bars.");
      return INIT_PARAMETERS_INCORRECT;
     }
   string parts[]; int np = StringSplit(InpSymbols, ',', parts);
   ArrayResize(gList, 0); gNs = 0;
   for(int i = 0; i < np && gNs < 20; i++) { string s = parts[i]; StringTrimLeft(s); StringTrimRight(s); if(s == "") continue; ArrayResize(gList, gNs + 1); gList[gNs++] = s; }
   if(gNs == 0) { Print("AT24 Setup Scanner: the watchlist is empty."); return INIT_PARAMETERS_INCORRECT; }
   ArrayResize(gRows, gNs); ArrayResize(gAlerted, gNs);
   for(int i = 0; i < gNs; i++) { gRows[i].ok = false; gRows[i].sym = gList[i]; gAlerted[i] = 0; }
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   bool visual = (bool)MQLInfoInteger(MQL_VISUAL_MODE);
   gDash = InpShowDash && (!tester || (InpDashInTester && visual));
   EventSetTimer(5);
   return INIT_SUCCEEDED;
  }

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(gDash && id == CHARTEVENT_CHART_CHANGE) BuildFrame();
  }

void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); }

void OnTimer() { Refresh(); Draw(); }

int OnCalculate(const int rates_total, const int prev_calculated, const datetime &time[], const double &open[],
                const double &high[], const double &low[], const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
  {
   if(rates_total < 2) return 0;
   Refresh();
   Draw();
   return rates_total;
  }
