//+------------------------------------------------------------------+
//|                                        AT24_PivotLevelsMap.mq5   |
//|   AT24 Pivot Levels Map - free education tool                    |
//|   Daily / Weekly / Monthly pivots + CPR + Camarilla levels       |
//|   Shows LEVELS and CONTEXT only. No buy/sell signals.           |
//|   v1.01: branded dashboard (AT24 logo, status, nearest levels,   |
//|          CPR, pivot table), same levels as v1.00                 |
//|   (c) algotraders24.ai                                           |
//+------------------------------------------------------------------+
#property copyright "algotraders24.ai"
#property link      "https://algotraders24.ai"
#property version   "1.02"
#property description "Daily / Weekly / Monthly pivots, CPR and Camarilla levels with a branded dashboard."
#property description "Licensed utility EA: draws and shows context only, it never places orders."
#property description "Education tool, not a signal. Past levels do not predict future price."

#include <Canvas/Canvas.mqh>

#define AT24_PRODUCT_ID "AT24-PIVOT-LEVELS-MAP"
#include "AT24_LicenseGate.mqh"

#resource "\\Images\\AT24\\at24_logo.bmp"

input group "=== LICENCE ==="
input string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)

input group "=== PERIODS ==="
input bool   InpShowDaily   = true;        // Show daily pivot levels
input bool   InpShowWeekly  = true;        // Show weekly pivot levels
input bool   InpShowMonthly = false;       // Show monthly pivot levels
input bool   InpShowR3S3    = false;       // Draw R3 / S3 on the chart as well (R1,R2,S1,S2 are always drawn)

input group "=== CPR AND CAMARILLA ==="
input bool   InpShowCPR     = true;        // Show daily CPR (TC / BC)
input bool   InpShowCama    = false;       // Show daily Camarilla H3/H4/L3/L4
input int    InpCprAvgDays  = 20;          // Days used to judge if the CPR is narrow or wide

input group "=== LOOK ==="
input color  InpColDaily    = clrGold;     // Daily color
input color  InpColWeekly   = clrDodgerBlue; // Weekly color
input color  InpColMonthly  = clrMediumOrchid; // Monthly color
input color  InpColCPR      = clrAqua;     // CPR color
input color  InpColCama     = clrTomato;   // Camarilla color
input int    InpLineWidth   = 1;           // Line width
input int    InpLabelSize   = 8;           // Label font size
input int    InpLabelBars   = 3;           // Labels are placed this many bars right of the last bar

input group "=== DASHBOARD ==="
input bool   InpShowPanel   = true;        // Show the dashboard
input bool   InpPanelInTester = false;     // Strategy Tester: show the dashboard only in visual mode when this is true
input int    InpPanelX      = 12;          // Dashboard X (pixels from the left)
input int    InpPanelY      = 28;          // Dashboard Y (pixels from the top)
input bool   InpSaveSnapshot = false;      // Save one chart screenshot to MQL5/Files/AT24_PivotLevelsMap_snapshot.png a few seconds after loading (for sharing)

#define PFX       "AT24PLM_"
#define DASH_NAME "AT24_PLM_DASH"
#define DASH_W    392
#define DASH_MAXH 520

#define GRP_D   0
#define GRP_W   1
#define GRP_M   2
#define GRP_CPR 3
#define GRP_CAM 4

struct Lvl
{
   int    grp;
   string tag;
   string key;
   double price;
   color  clr;
   ENUM_LINE_STYLE style;
   datetime from;
};

Lvl      g_lv[];
int      g_n = 0;
datetime g_lastUpdate = 0;
datetime g_dayStart = 0;
string   g_cprText = "";
color    g_cprCol  = clrSilver;
double   g_cprWidth = 0, g_cprAvg = 0;
bool     g_incomplete = false;     // CPR average missing: history still loading, retry
uint     g_retryAt = 0;

CCanvas  g_cv;
bool     g_dashOn = false;
bool     g_snapDone = false;
datetime g_initTime = 0;
bool     g_dry    = false;      // layout pass: measure the height, draw nothing
uint     g_logo[];
int      g_logoW = 0, g_logoH = 0;
bool     g_logoAlpha = false;       // BMP may carry no alpha: then every pixel is opaque

//+------------------------------------------------------------------+
//| Levels                                                           |
//+------------------------------------------------------------------+
void AddLvl(const int grp, const string tag, const string key, const double price, const color clr, const ENUM_LINE_STYLE style, const datetime from)
{
   ArrayResize(g_lv, g_n + 1);
   g_lv[g_n].grp   = grp;
   g_lv[g_n].tag   = tag;
   g_lv[g_n].key   = key;
   g_lv[g_n].price = price;
   g_lv[g_n].clr   = clr;
   g_lv[g_n].style = style;
   g_lv[g_n].from  = from;
   g_n++;
}

string LvlName(const int i) { return g_lv[i].tag + " " + g_lv[i].key; }

// previous COMPLETED bar of the given period; curStart = start of the CURRENT period
bool PrevBar(const ENUM_TIMEFRAMES tf, double &h, double &l, double &c, datetime &curStart)
{
   MqlRates r[];
   if(CopyRates(_Symbol, tf, 0, 2, r) < 2) return false;      // r[0] = previous completed, r[1] = current
   curStart = r[1].time;
   h = r[0].high; l = r[0].low; c = r[0].close;
   return (h > 0 && l > 0 && c > 0 && h >= l);
}

void AddPivotSet(const int grp, const string tag, const ENUM_TIMEFRAMES tf, const color clr)
{
   double h, l, c; datetime st;
   if(!PrevBar(tf, h, l, c, st)) return;
   double p  = (h + l + c) / 3.0;
   double r1 = 2.0 * p - l,  s1 = 2.0 * p - h;
   double r2 = p + (h - l),  s2 = p - (h - l);
   double r3 = h + 2.0 * (p - l), s3 = l - 2.0 * (h - p);
   AddLvl(grp, tag, "P",  p,  clr, STYLE_SOLID, st);
   AddLvl(grp, tag, "R1", r1, clr, STYLE_DOT,   st);
   AddLvl(grp, tag, "R2", r2, clr, STYLE_DOT,   st);
   AddLvl(grp, tag, "S1", s1, clr, STYLE_DOT,   st);
   AddLvl(grp, tag, "S2", s2, clr, STYLE_DOT,   st);
   if(InpShowR3S3)
   {
      AddLvl(grp, tag, "R3", r3, clr, STYLE_DOT, st);
      AddLvl(grp, tag, "S3", s3, clr, STYLE_DOT, st);
   }
}

// CPR width as percent of the pivot, from one completed day's high / low / close
double CprWidthPct(const double h, const double l, const double c)
{
   double p  = (h + l + c) / 3.0;
   double bc = (h + l) / 2.0;
   double tc = 2.0 * p - bc;
   return (p > 0) ? MathAbs(tc - bc) / p * 100.0 : 0.0;
}

void BuildLevels()
{
   g_n = 0;
   ArrayResize(g_lv, 0);
   g_cprText = ""; g_cprWidth = 0; g_cprAvg = 0; g_cprCol = clrSilver; g_incomplete = false;

   if(InpShowDaily)   AddPivotSet(GRP_D, "D", PERIOD_D1,  InpColDaily);
   if(InpShowWeekly)  AddPivotSet(GRP_W, "W", PERIOD_W1,  InpColWeekly);
   if(InpShowMonthly) AddPivotSet(GRP_M, "M", PERIOD_MN1, InpColMonthly);

   double h, l, c; datetime st;
   if(!PrevBar(PERIOD_D1, h, l, c, st)) return;

   if(InpShowCPR)
   {
      double p  = (h + l + c) / 3.0;
      double bc = (h + l) / 2.0;
      double tc = 2.0 * p - bc;
      AddLvl(GRP_CPR, "CPR", "TC", MathMax(tc, bc), InpColCPR, STYLE_SOLID, st);
      AddLvl(GRP_CPR, "CPR", "BC", MathMin(tc, bc), InpColCPR, STYLE_SOLID, st);

      int n = MathMax(InpCprAvgDays, 5);
      MqlRates r[];
      int got = CopyRates(_Symbol, PERIOD_D1, 1, n, r);          // completed days only
      g_cprWidth = CprWidthPct(h, l, c);
      double sum = 0; int cnt = 0;
      for(int i = 0; i < got; i++) { sum += CprWidthPct(r[i].high, r[i].low, r[i].close); cnt++; }
      g_cprAvg = (cnt >= 5) ? sum / cnt : 0;
      if(g_cprAvg <= 0) g_incomplete = true;
      string kind = (g_cprAvg > 0) ? "normal" : "loading history...";
      if(g_cprAvg > 0)
      {
         double ratio = g_cprWidth / g_cprAvg;
         if(ratio < 0.7)      { kind = "NARROW vs average"; g_cprCol = clrAqua; }
         else if(ratio > 1.3) { kind = "WIDE vs average";   g_cprCol = clrOrange; }
      }
      g_cprText = kind;
   }
   if(InpShowCama)
   {
      double rg = h - l;
      AddLvl(GRP_CAM, "Cama", "H4", c + rg * 1.1 / 2.0, InpColCama, STYLE_DASH, st);
      AddLvl(GRP_CAM, "Cama", "H3", c + rg * 1.1 / 4.0, InpColCama, STYLE_DASH, st);
      AddLvl(GRP_CAM, "Cama", "L3", c - rg * 1.1 / 4.0, InpColCama, STYLE_DASH, st);
      AddLvl(GRP_CAM, "Cama", "L4", c - rg * 1.1 / 2.0, InpColCama, STYLE_DASH, st);
   }
}

int FindLvl(const int grp, const string key)
{
   for(int i = 0; i < g_n; i++) if(g_lv[i].grp == grp && g_lv[i].key == key) return i;
   return -1;
}

//+------------------------------------------------------------------+
//| Lines and labels on the chart                                    |
//+------------------------------------------------------------------+
void DeleteAll()
{
   for(int i = ObjectsTotal(0, 0, -1) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i, 0, -1);
      if(StringFind(nm, PFX) == 0) ObjectDelete(0, nm);
   }
}

string LvlObj(const int i) { return PFX + "L" + IntegerToString(i); }
string TxtObj(const int i) { return PFX + "T" + IntegerToString(i); }

void DrawLevels(const datetime lastBar)
{
   DeleteAll();
   datetime lblTime = lastBar + (datetime)(InpLabelBars * PeriodSeconds());
   for(int i = 0; i < g_n; i++)
   {
      string ln = LvlObj(i);
      if(ObjectCreate(0, ln, OBJ_TREND, 0, g_lv[i].from, g_lv[i].price, lastBar, g_lv[i].price))
      {
         ObjectSetInteger(0, ln, OBJPROP_COLOR, g_lv[i].clr);
         ObjectSetInteger(0, ln, OBJPROP_STYLE, g_lv[i].style);
         ObjectSetInteger(0, ln, OBJPROP_WIDTH, InpLineWidth);
         ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT, true);
         ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, ln, OBJPROP_HIDDEN, true);
         ObjectSetInteger(0, ln, OBJPROP_BACK, true);
         ObjectSetString(0, ln, OBJPROP_TOOLTIP, LvlName(i) + "  " + DoubleToString(g_lv[i].price, _Digits));
      }
      string tn = TxtObj(i);
      if(ObjectCreate(0, tn, OBJ_TEXT, 0, lblTime, g_lv[i].price))
      {
         ObjectSetString(0, tn, OBJPROP_TEXT, LvlName(i) + " " + DoubleToString(g_lv[i].price, _Digits));
         ObjectSetInteger(0, tn, OBJPROP_COLOR, g_lv[i].clr);
         ObjectSetInteger(0, tn, OBJPROP_FONTSIZE, InpLabelSize);
         ObjectSetInteger(0, tn, OBJPROP_ANCHOR, ANCHOR_LEFT_LOWER);
         ObjectSetInteger(0, tn, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, tn, OBJPROP_HIDDEN, true);
      }
   }
}

void MoveLabels(const datetime lastBar)
{
   datetime lblTime = lastBar + (datetime)(InpLabelBars * PeriodSeconds());
   for(int i = 0; i < g_n; i++)
      ObjectSetInteger(0, TxtObj(i), OBJPROP_TIME, lblTime);
}

//+------------------------------------------------------------------+
//| Dashboard                                                        |
//+------------------------------------------------------------------+
uint DC(const color c, const int a = 255) { return ColorToARGB(c, (uchar)a); }

void DText(const int x, const int y, const string s, const color c, const int size = 12, const bool bold = false, const uint align = TA_LEFT | TA_TOP)
{
   if(g_dry) return;
   g_cv.FontSet("Segoe UI", size, bold ? FW_BOLD : FW_NORMAL);
   g_cv.TextOut(x, y, s, DC(c), align);
}

void DRow(const int y, const string label, const string value, const color vc)
{
   DText(14, y, label, C'150,160,175');
   DText(DASH_W - 14, y, value, vc, 12, true, TA_RIGHT | TA_TOP);
}

void DSep(const int y, const string title)
{
   if(g_dry) return;
   g_cv.FillRectangle(14, y + 8, 20, y + 9, DC(C'70,80,100'));
   DText(26, y, title, C'110,170,255', 11, true);
   g_cv.FillRectangle(26 + 8 * StringLen(title) + 10, y + 8, DASH_W - 14, y + 9, DC(C'50,58,76'));
}

void LoadLogo()
{
   g_logoW = 0; g_logoH = 0;
   uint px[]; uint w = 0, h = 0;
   ResetLastError();
   bool okRead = ResourceReadImage("::Images\\AT24\\at24_logo.bmp", px, w, h);
   if(!okRead) PrintFormat("AT24 Pivot Levels Map: logo read failed, error %d", GetLastError());
   if(okRead && w > 0 && h > 0)
   {
      ArrayCopy(g_logo, px);
      g_logoW = (int)w; g_logoH = (int)h;
      g_logoAlpha = false;
      for(int i = 0; i < ArraySize(g_logo); i++) if(((g_logo[i] >> 24) & 0xFF) != 0) { g_logoAlpha = true; break; }
   }
}

// logo scaled to sz x sz by box averaging, blended over the header color
void DrawLogo(const int x, const int y, const int sz)
{
   if(g_dry) return;
   if(g_logoW <= 0)
   {
      DText(x, y + 6, "AT24", C'230,180,60', 13, true);
      return;
   }
   const int bgR = 28, bgG = 36, bgB = 54;
   for(int j = 0; j < sz; j++)
   {
      int y0 = j * g_logoH / sz, y1 = MathMax(y0 + 1, (j + 1) * g_logoH / sz);
      for(int i = 0; i < sz; i++)
      {
         int x0 = i * g_logoW / sz, x1 = MathMax(x0 + 1, (i + 1) * g_logoW / sz);
         double sa = 0, sr = 0, sg = 0, sb = 0; int cnt = 0;
         for(int yy = y0; yy < y1 && yy < g_logoH; yy++)
            for(int xx = x0; xx < x1 && xx < g_logoW; xx++)
            {
               uint p = g_logo[yy * g_logoW + xx];
               double a = g_logoAlpha ? (double)((p >> 24) & 0xFF) : 255.0;
               sa += a;
               sr += a * (double)((p >> 16) & 0xFF);
               sg += a * (double)((p >> 8) & 0xFF);
               sb += a * (double)(p & 0xFF);
               cnt++;
            }
         if(cnt == 0 || sa <= 0) continue;
         double aa = sa / cnt / 255.0;
         int r = (int)MathRound((sr / sa) * aa + bgR * (1.0 - aa));
         int g = (int)MathRound((sg / sa) * aa + bgG * (1.0 - aa));
         int b = (int)MathRound((sb / sa) * aa + bgB * (1.0 - aa));
         g_cv.PixelSet(x + i, y + j, ColorToARGB(
            (color)(((b & 0xFF) << 16) | ((g & 0xFF) << 8) | (r & 0xFF)), 255));
      }
   }
}

bool PanelAllowed()
{
   if(!InpShowPanel) return false;
   if(MQLInfoInteger(MQL_TESTER)) return (InpPanelInTester && MQLInfoInteger(MQL_VISUAL_MODE));
   return true;
}

string PriceTxt(const double v) { return DoubleToString(v, _Digits); }

string Signed(const double v) { return (v >= 0 ? "+" : "-") + DoubleToString(MathAbs(v), _Digits); }

// one row of the pivot table: label + P R1 R2 S1 S2 (nearest cell highlighted)
void TableRow(const int y, const int grp, const string tag, const color clr, const int nearest)
{
   DText(14, y, tag, clr, 12, true);
   string keys[5] = {"P", "R1", "R2", "S1", "S2"};
   for(int k = 0; k < 5; k++)
   {
      int cx = 76 + k * 64;
      int idx = FindLvl(grp, keys[k]);
      if(idx < 0) { DText(cx, y, "-", C'120,130,145', 12, false, TA_CENTER | TA_TOP); continue; }
      if(!g_dry && idx == nearest)
         g_cv.FillRectangle(cx - 31, y - 2, cx + 31, y + 17, DC(C'60,72,98'));
      DText(cx, y, PriceTxt(g_lv[idx].price), clr, 12, idx == nearest, TA_CENTER | TA_TOP);
   }
}

// layout pass: returns the y where the panel ends. g_dry = true only measures.
int Layout(const double bid)
{
   // ---- header
   int y = 0;
   if(!g_dry)
   {
      g_cv.FillRectangle(0, 0, DASH_W - 1, 46, DC(C'28,36,54'));
      g_cv.FillRectangle(0, 46, DASH_W - 1, 47, DC(C'230,180,60'));      // brand gold line
   }
   DrawLogo(6, 3, 40);
   DText(54, 5, "AT24 PIVOT LEVELS MAP", C'235,240,250', 13, true);
   DText(54, 26, "algotraders24.ai  |  free education tool", C'150,160,175', 10);
   string tf = StringSubstr(EnumToString((ENUM_TIMEFRAMES)_Period), 7);
   DText(DASH_W - 14, 6, _Symbol, C'235,240,250', 12, true, TA_RIGHT | TA_TOP);
   DText(DASH_W - 14, 26, tf, C'150,160,175', 10, false, TA_RIGHT | TA_TOP);

   // ---- status
   y = 56;
   int top = FindLvl(GRP_CPR, "TC"), bot = FindLvl(GRP_CPR, "BC");
   DText(14, y, bid > 0 ? "Price  " + PriceTxt(bid) : "Price  -", C'235,240,250', 13, true);
   if(top >= 0 && bot >= 0 && bid > 0)
   {
      string pos; color pc;
      if(bid > g_lv[top].price)      { pos = "ABOVE the CPR";  pc = C'80,220,140'; }
      else if(bid < g_lv[bot].price) { pos = "BELOW the CPR";  pc = C'255,120,120'; }
      else                           { pos = "INSIDE the CPR"; pc = C'255,190,80'; }
      DText(DASH_W - 14, y, pos, pc, 13, true, TA_RIGHT | TA_TOP);
   }

   // ---- nearest levels above and below the price
   int ab = -1, be = -1;
   double dab = DBL_MAX, dbe = DBL_MAX;
   int nearest = -1; double dn = DBL_MAX;
   for(int i = 0; i < g_n && bid > 0; i++)
   {
      double d = g_lv[i].price - bid;
      if(MathAbs(d) < dn) { dn = MathAbs(d); nearest = i; }
      if(d > 0 && d < dab)  { dab = d; ab = i; }
      if(d <= 0 && -d < dbe) { dbe = -d; be = i; }
   }
   y += 28;
   DSep(y, "NEAREST LEVELS");
   y += 22;
   if(ab >= 0) DRow(y, "Above:  " + LvlName(ab), PriceTxt(g_lv[ab].price) + "   (+" + PriceTxt(dab) + ")", g_lv[ab].clr);
   else        DRow(y, "Above", "none", C'120,130,145');
   y += 20;
   if(be >= 0) DRow(y, "Below:  " + LvlName(be), PriceTxt(g_lv[be].price) + "   (-" + PriceTxt(dbe) + ")", g_lv[be].clr);
   else        DRow(y, "Below", "none", C'120,130,145');

   // ---- CPR
   if(top >= 0 && bot >= 0)
   {
      y += 28;
      DSep(y, "CPR (TODAY)");
      y += 22; DRow(y, "Top (TC)", PriceTxt(g_lv[top].price), InpColCPR);
      y += 20; DRow(y, "Bottom (BC)", PriceTxt(g_lv[bot].price), InpColCPR);
      y += 20; DRow(y, "Width / average", g_cprAvg > 0 ? StringFormat("%.3f%% / %.3f%%", g_cprWidth, g_cprAvg) : StringFormat("%.3f%% / n/a", g_cprWidth), C'235,240,250');
      y += 20; DRow(y, "Compared with last " + IntegerToString(MathMax(InpCprAvgDays, 5)) + " days", g_cprText, g_cprCol);
   }

   // ---- pivot table
   bool anySet = (InpShowDaily || InpShowWeekly || InpShowMonthly);
   if(anySet)
   {
      y += 28;
      DSep(y, "PIVOT LEVELS");
      y += 22;
      string hd[5] = {"P", "R1", "R2", "S1", "S2"};
      for(int k = 0; k < 5; k++) DText(76 + k * 64, y, hd[k], C'150,160,175', 11, false, TA_CENTER | TA_TOP);
      if(InpShowDaily)   { y += 20; TableRow(y, GRP_D, "D", InpColDaily,   nearest); }
      if(InpShowWeekly)  { y += 20; TableRow(y, GRP_W, "W", InpColWeekly,  nearest); }
      if(InpShowMonthly) { y += 20; TableRow(y, GRP_M, "M", InpColMonthly, nearest); }
   }

   // ---- Camarilla
   if(InpShowCama)
   {
      y += 28;
      DSep(y, "CAMARILLA (DAILY)");
      y += 22;
      string ck[4] = {"H4", "H3", "L3", "L4"};
      for(int k = 0; k < 4; k++) DText(76 + k * 64, y, ck[k], C'150,160,175', 11, false, TA_CENTER | TA_TOP);
      y += 20;
      DText(14, y, "Cama", InpColCama, 12, true);
      for(int k = 0; k < 4; k++)
      {
         int idx = FindLvl(GRP_CAM, ck[k]);
         int cx = 76 + k * 64;
         if(idx < 0) { DText(cx, y, "-", C'120,130,145', 12, false, TA_CENTER | TA_TOP); continue; }
         if(!g_dry && idx == nearest) g_cv.FillRectangle(cx - 31, y - 2, cx + 31, y + 17, DC(C'60,72,98'));
         DText(cx, y, PriceTxt(g_lv[idx].price), InpColCama, 12, idx == nearest, TA_CENTER | TA_TOP);
      }
   }

   // ---- footer
   y += 30;
   if(!g_dry) g_cv.FillRectangle(14, y, DASH_W - 14, y + 1, DC(C'50,58,76'));
   DText(14, y + 6, "Levels use the previous completed day / week / month.", C'120,130,145', 10);
   DText(14, y + 22, "Education tool, not a signal. Past levels do not predict price.", C'255,190,80', 10);
   return y + 42;
}

void DrawDash()
{
   if(!g_dashOn) return;
   static uint lastDraw = 0;
   uint nowMs = GetTickCount();
   if(nowMs - lastDraw < 400) return;
   lastDraw = nowMs;

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   g_dry = true;
   int h = MathMin(Layout(bid), DASH_MAXH);
   g_dry = false;

   g_cv.Erase(DC(C'0,0,0', 0));
   g_cv.FillRectangle(0, 0, DASH_W - 1, h - 1, DC(C'16,20,30', 235));
   g_cv.Rectangle(0, 0, DASH_W - 1, h - 1, DC(C'60,72,98'));
   Layout(bid);
   g_cv.Update();
}

void DashCreate()
{
   if(!PanelAllowed()) return;
   if(!g_cv.CreateBitmapLabel(0, 0, DASH_NAME, InpPanelX, InpPanelY, DASH_W, DASH_MAXH, COLOR_FORMAT_ARGB_NORMALIZE))
   {
      Print("AT24 Pivot Levels Map: dashboard could not be created, error ", GetLastError());
      return;
   }
   ObjectSetInteger(0, DASH_NAME, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, DASH_NAME, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, DASH_NAME, OBJPROP_HIDDEN, true);
   LoadLogo();
   g_dashOn = true;
   EventSetTimer(1);
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   g_dayStart = 0;
   g_lastUpdate = 0;
   g_snapDone = false;
   g_initTime = TimeLocal();
   DashCreate();
   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_dashOn) { g_cv.Destroy(); g_dashOn = false; }
   DeleteAll();
   Comment("");
}

void Stopped()
{
   // licence refused later on (revoked / moved to another account): clear the chart, the gate shows the reason
   DeleteAll();
   if(g_dashOn) { g_cv.Erase(0); g_cv.Update(); }
}

void Update()
{
   if(!AT24Gate_Allowed()) { Stopped(); return; }
   if(Bars(_Symbol, _Period) < 2) return;

   datetime lastBar = iTime(_Symbol, _Period, 0);
   datetime day = iTime(_Symbol, PERIOD_D1, 0);
   if(lastBar == 0 || day == 0) return;

   if(g_incomplete && GetTickCount() >= g_retryAt) { g_retryAt = GetTickCount() + 3000; g_dayStart = 0; }
   if(day != g_dayStart || g_n == 0)
   {
      BuildLevels();
      if(g_n == 0) return;
      DrawLevels(lastBar);
      g_dayStart = day;
   }
   else if(lastBar != g_lastUpdate)
   {
      MoveLabels(lastBar);
   }
   g_lastUpdate = lastBar;
   DrawDash();
}

void OnTimer()
{
   AT24Gate_Timer(InpLicenseKey);
   Update();
   if(InpSaveSnapshot && !g_snapDone && g_n > 0 && TimeLocal() - g_initTime >= 4)
   {
      g_snapDone = true;
      string fn = "AT24_PivotLevelsMap_snapshot.png";
      if(ChartScreenShot(0, fn, 1280, 720, ALIGN_RIGHT)) Print("AT24 Pivot Levels Map: snapshot saved to MQL5/Files/", fn);
   }
}

void OnTick() { Update(); }
