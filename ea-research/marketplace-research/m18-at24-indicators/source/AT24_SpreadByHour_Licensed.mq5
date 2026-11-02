//+------------------------------------------------------------------+
//|                                     AT24_SpreadByHour.mq5  |
//|   AT24 Spread by Hour - free education tool                      |
//|   Average spread (points) for each hour of the day.              |
//|   Shows past averages only. No buy/sell signals.                 |
//|   (c) algotraders24.ai                                           |
//+------------------------------------------------------------------+
#property copyright "algotraders24.ai"
#property link      "https://algotraders24.ai"
#property version   "1.01"
#property description "When the spread is widest and tightest on this symbol: a 24-hour heatmap of the average spread from the broker tick history."
#property description "Licensed utility EA: draws and shows context only, it never places orders."
#property description "Education tool, not a signal. Past averages do not predict future price."

#include <Canvas/Canvas.mqh>

#define AT24_PRODUCT_ID "AT24-SPREAD-BY-HOUR"
#include "AT24_LicenseGate.mqh"

#resource "\\Images\\AT24\\at24_logo.bmp"

input group "=== LICENCE ==="
input string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)

input group "=== DATA ==="
input int    InpDays        = 10;          // Trading days of tick history used (about 23 hours per day; more days = slower first load)
input int    InpShiftHours  = 0;           // Show hour labels shifted from broker time by this many hours (your local time)

input group "=== LOOK ==="
input color  InpColTight    = C'35,110,125';   // Tight spread color
input color  InpColWide     = C'230,150,60';   // Wide spread color

input group "=== DASHBOARD ==="
input bool   InpShowPanel   = true;        // Show the dashboard
input bool   InpPanelInTester = false;     // Strategy Tester: show the dashboard only in visual mode when this is true
input int    InpPanelX      = 12;          // Dashboard X (pixels from the left)
input int    InpPanelY      = 28;          // Dashboard Y (pixels from the top)

#define DASH_NAME "AT24_SBH_DASH"
#define DASH_W    392
#define DASH_MAXH 420
#define MIN_DAYS_PER_HOUR 5

double   g_avg[24];
int      g_cnt[24];
bool     g_ok = false;
int      g_bars = 0;
double   g_maxAvg = 0, g_minAvg = 0, g_meanAvg = 0;
datetime g_lastH1 = 0;

CCanvas  g_cv;
bool     g_dashOn = false;
bool     g_dry = false;
uint     g_logo[];
int      g_logoW = 0, g_logoH = 0;
bool     g_logoAlpha = false;

//+------------------------------------------------------------------+
//| Statistics                                                       |
//+------------------------------------------------------------------+
double   g_sum[24];
int      g_cntH[24];
datetime g_scanTimes[];
int      g_scanN = 0, g_scanPos = 0;
datetime g_lastDone = 0;
bool     g_scanning = false;
datetime g_failed[];                // hours whose ticks were not available yet (tick history loads from the server on demand)
int      g_failN = 0, g_passes = 0;
uint     g_waitUntil = 0;

void FinalizeStats()
{
   ArrayInitialize(g_avg, 0.0);
   ArrayInitialize(g_cnt, 0);
   g_maxAvg = 0; g_minAvg = DBL_MAX; g_meanAvg = 0; g_bars = 0;
   int valid = 0;
   for(int h = 0; h < 24; h++)
   {
      g_cnt[h] = g_cntH[h];
      g_bars += g_cntH[h];
      if(g_cntH[h] < MIN_DAYS_PER_HOUR) continue;
      g_avg[h] = g_sum[h] / g_cntH[h];
      g_maxAvg = MathMax(g_maxAvg, g_avg[h]);
      g_minAvg = MathMin(g_minAvg, g_avg[h]);
      g_meanAvg += g_avg[h];
      valid++;
   }
   g_ok = false;
   if(valid < 6 || g_maxAvg <= 0) return;
   g_meanAvg /= valid;
   g_ok = true;
}

// completed H1 bars not scanned yet
void CollectBars()
{
   MqlRates r[];
   int need = MathMax(InpDays, 2) * 23 + 5;
   int got = CopyRates(_Symbol, PERIOD_H1, 1, need, r);
   if(got < 24) return;
   ArrayResize(g_scanTimes, got);
   g_scanN = 0;
   for(int i = 0; i < got; i++) if(r[i].time > g_lastDone) g_scanTimes[g_scanN++] = r[i].time;
   g_scanPos = 0;
   g_scanning = (g_scanN > 0);
}

// average spread in points over all ticks of the hour that starts at t; -1 when there are no ticks
double HourSpread(const datetime t)
{
   MqlTick ticks[];
   int n = CopyTicksRange(_Symbol, ticks, COPY_TICKS_INFO, (ulong)t * 1000, (ulong)(t + 3600) * 1000 - 1);
   if(n <= 0) return -1.0;
   double s = 0; int c = 0;
   for(int i = 0; i < n; i++)
      if(ticks[i].bid > 0 && ticks[i].ask >= ticks[i].bid) { s += (ticks[i].ask - ticks[i].bid) / _Point; c++; }
   return (c > 0) ? s / c : -1.0;
}

void ScanStep()
{
   if(!g_scanning || GetTickCount() < g_waitUntil) return;
   int steps = 0;
   while(g_scanPos < g_scanN && steps < 10)
   {
      datetime t = g_scanTimes[g_scanPos++];
      steps++;
      double sp = HourSpread(t);
      if(sp >= 0)
      {
         MqlDateTime dt; TimeToStruct(t, dt);
         g_sum[dt.hour] += sp;
         g_cntH[dt.hour]++;
      }
      else
      {
         ArrayResize(g_failed, g_failN + 1);
         g_failed[g_failN++] = t;
      }
      if(t > g_lastDone) g_lastDone = t;
   }
   if(g_scanPos < g_scanN) return;

   // pass finished: try the hours without ticks again a few times, then work with what we have
   if(g_failN > 0 && g_passes < 12)
   {
      g_passes++;
      ArrayResize(g_scanTimes, g_failN);
      for(int i = 0; i < g_failN; i++) g_scanTimes[i] = g_failed[i];
      g_scanN = g_failN; g_scanPos = 0; g_failN = 0;
      g_waitUntil = GetTickCount() + 5000;
      return;
   }
   g_scanning = false;
   g_failN = 0; g_passes = 0;
   FinalizeStats();
}

string HourLabel(const int h)
{
   int x = ((h + InpShiftHours) % 24 + 24) % 24;
   return StringFormat("%02d:00", x);
}

// index of the k-th busiest (desc = true) or quietest hour among valid hours, excluding the ones already taken
int PickHour(const bool busiest, const int &taken[], const int nTaken)
{
   int best = -1;
   for(int h = 0; h < 24; h++)
   {
      if(g_avg[h] <= 0) continue;
      bool used = false;
      for(int k = 0; k < nTaken; k++) if(taken[k] == h) { used = true; break; }
      if(used) continue;
      if(best < 0 || (busiest ? g_avg[h] > g_avg[best] : g_avg[h] < g_avg[best])) best = h;
   }
   return best;
}

string TopList(const bool busiest)
{
   int taken[3]; int n = 0;
   string s = "";
   for(int k = 0; k < 3; k++)
   {
      int h = PickHour(busiest, taken, n);
      if(h < 0) break;
      taken[n++] = h;
      s += (k > 0 ? "   " : "") + HourLabel(h) + " (" + DoubleToString(g_avg[h], 0) + ")";
   }
   return s;
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
   if(!okRead) PrintFormat("AT24 Spread by Hour: logo read failed, error %d", GetLastError());
   if(okRead && w > 0 && h > 0)
   {
      ArrayCopy(g_logo, px);
      g_logoW = (int)w; g_logoH = (int)h;
      g_logoAlpha = false;
      for(int i = 0; i < ArraySize(g_logo); i++) if(((g_logo[i] >> 24) & 0xFF) != 0) { g_logoAlpha = true; break; }
   }
}

void DrawLogo(const int x, const int y, const int sz)
{
   if(g_dry) return;
   if(g_logoW <= 0) { DText(x, y + 8, "AT24", C'230,180,60', 13, true); return; }
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
         g_cv.PixelSet(x + i, y + j, ColorToARGB((color)(((b & 0xFF) << 16) | ((g & 0xFF) << 8) | (r & 0xFF)), 255));
      }
   }
}

color Lerp(const color a, const color b, const double t)
{
   int ar = a & 0xFF, ag = (a >> 8) & 0xFF, ab = (a >> 16) & 0xFF;
   int br = b & 0xFF, bg = (b >> 8) & 0xFF, bb = (b >> 16) & 0xFF;
   double k = MathMax(0.0, MathMin(1.0, t));
   int r = (int)MathRound(ar + (br - ar) * k), g = (int)MathRound(ag + (bg - ag) * k), bl = (int)MathRound(ab + (bb - ab) * k);
   return (color)((bl << 16) | (g << 8) | r);
}

bool PanelAllowed()
{
   if(!InpShowPanel) return false;
   if(MQLInfoInteger(MQL_TESTER)) return (InpPanelInTester && MQLInfoInteger(MQL_VISUAL_MODE));
   return true;
}

int Layout()
{
   // ---- header
   if(!g_dry)
   {
      g_cv.FillRectangle(0, 0, DASH_W - 1, 46, DC(C'28,36,54'));
      g_cv.FillRectangle(0, 46, DASH_W - 1, 47, DC(C'230,180,60'));
   }
   DrawLogo(6, 3, 40);
   DText(54, 5, "AT24 SPREAD BY HOUR", C'235,240,250', 13, true);
   DText(54, 26, "algotraders24.ai  |  free education tool", C'150,160,175', 10);
   DText(DASH_W - 14, 6, _Symbol, C'235,240,250', 12, true, TA_RIGHT | TA_TOP);
   DText(DASH_W - 14, 26, "points", C'150,160,175', 10, false, TA_RIGHT | TA_TOP);

   int y = 56;
   if(!g_ok)
   {
      DText(14, y, g_scanning ? StringFormat("Reading tick history... %d / %d hours%s", g_scanPos, g_scanN, g_passes > 0 ? "  (retry)" : "") : "No tick history available yet", C'255,190,80', 12, true);
      y += 28;
      DText(14, y, "First load can take a minute. Needs the broker tick history.", C'150,160,175', 10);
      y += 36;
      DText(14, y, "Education tool, not a signal.", C'255,190,80', 10);
      return y + 24;
   }

   // current hour
   MqlRates cur[];
   int curHour = -1; double curRange = 0;
   if(CopyRates(_Symbol, PERIOD_H1, 0, 1, cur) == 1)
   {
      MqlDateTime dt; TimeToStruct(cur[0].time, dt);
      curHour = dt.hour; curRange = (double)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   }

   // ---- heat strip
   DSep(y, "AVERAGE SPREAD BY HOUR");
   y += 24;
   const int stripTop = y, stripH = 64, cellW = 14, x0 = 14;
   for(int h = 0; h < 24; h++)
   {
      int x = x0 + h * cellW;
      if(g_avg[h] <= 0)
      {
         if(!g_dry) g_cv.FillRectangle(x, stripTop + stripH - 3, x + cellW - 3, stripTop + stripH, DC(C'50,58,76'));
         continue;
      }
      double t = (g_maxAvg > g_minAvg) ? (g_avg[h] - g_minAvg) / (g_maxAvg - g_minAvg) : 0.5;
      int bh = 8 + (int)MathRound((stripH - 8) * (g_avg[h] / g_maxAvg));
      if(!g_dry) g_cv.FillRectangle(x, stripTop + stripH - bh, x + cellW - 3, stripTop + stripH, DC(Lerp(InpColTight, InpColWide, t)));
      if(!g_dry && h == curHour) g_cv.Rectangle(x - 1, stripTop - 2, x + cellW - 2, stripTop + stripH + 1, DC(C'235,240,250'));
   }
   for(int h = 0; h < 24; h += 3)
      DText(x0 + h * cellW + 5, stripTop + stripH + 4, StringFormat("%02d", ((h + InpShiftHours) % 24 + 24) % 24), C'150,160,175', 10, false, TA_CENTER | TA_TOP);
   y = stripTop + stripH + 26;

   // ---- facts
   DSep(y, "WIDEST AND TIGHTEST");
   y += 22; DRow(y, "Widest", TopList(true), C'245,158,11');
   y += 20; DRow(y, "Tightest", TopList(false), C'45,212,191');
   if(g_minAvg > 0) { y += 20; DRow(y, "Widest vs tightest hour", StringFormat("%.1fx", g_maxAvg / g_minAvg), C'235,240,250'); }

   // ---- now
   y += 28;
   DSep(y, "THIS HOUR");
   if(curHour >= 0 && g_avg[curHour] > 0)
   {
      y += 22; DRow(y, "Hour (" + (InpShiftHours == 0 ? "broker time" : "shifted") + ")", HourLabel(curHour), C'235,240,250');
      y += 20; DRow(y, "Spread now / usual this hour (pts)", DoubleToString(curRange, 0) + " / " + DoubleToString(g_avg[curHour], 0), C'235,240,250');
      y += 20; DRow(y, "Usual this hour vs all hours", StringFormat("%.0f%%", g_avg[curHour] / g_meanAvg * 100.0), g_avg[curHour] >= g_meanAvg ? C'245,158,11' : C'45,212,191');
   }
   else
   {
      y += 22; DRow(y, "This hour", "no data", C'120,130,145');
   }

   // ---- footer
   y += 30;
   if(!g_dry) g_cv.FillRectangle(14, y, DASH_W - 14, y + 1, DC(C'50,58,76'));
   DText(14, y + 6, StringFormat("Average spread from tick history, %d hours (about %d days).", g_bars, g_bars / 23), C'120,130,145', 10);
   DText(14, y + 22, "Education tool, not a signal. Spreads change with your broker and news.", C'255,190,80', 10);
   return y + 42;
}

void DrawDash()
{
   if(!g_dashOn) return;
   static uint lastDraw = 0;
   uint nowMs = GetTickCount();
   if(nowMs - lastDraw < 400) return;
   lastDraw = nowMs;

   g_dry = true;
   int h = MathMin(Layout(), DASH_MAXH);
   g_dry = false;

   g_cv.Erase(DC(C'0,0,0', 0));
   g_cv.FillRectangle(0, 0, DASH_W - 1, h - 1, DC(C'16,20,30', 235));
   g_cv.Rectangle(0, 0, DASH_W - 1, h - 1, DC(C'60,72,98'));
   Layout();
   g_cv.Update();
}

void DashCreate()
{
   if(!PanelAllowed()) return;
   if(!g_cv.CreateBitmapLabel(0, 0, DASH_NAME, InpPanelX, InpPanelY, DASH_W, DASH_MAXH, COLOR_FORMAT_ARGB_NORMALIZE))
   {
      Print("AT24 Spread by Hour: dashboard could not be created, error ", GetLastError());
      return;
   }
   ObjectSetInteger(0, DASH_NAME, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, DASH_NAME, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, DASH_NAME, OBJPROP_HIDDEN, true);
   LoadLogo();
   g_dashOn = true;
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   g_lastH1 = 0;
   DashCreate();
   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_dashOn) { g_cv.Destroy(); g_dashOn = false; }
   Comment("");
}

void Refresh()
{
   datetime h1 = iTime(_Symbol, PERIOD_H1, 0);
   if(h1 == 0) return;
   static uint retryAt = 0;
   if(g_scanning) { ScanStep(); return; }
   if(h1 != g_lastH1 || !g_ok)
   {
      if(!g_ok && GetTickCount() < retryAt) return;
      retryAt = GetTickCount() + 5000;
      CollectBars();
      if(g_scanning) { g_lastH1 = h1; ScanStep(); }
      else if(g_ok) g_lastH1 = h1;
   }
}

void Step()
{
   if(!AT24Gate_Allowed())
   {
      if(g_dashOn) { g_cv.Erase(0); g_cv.Update(); }
      return;
   }
   Refresh();
   DrawDash();
}

void OnTimer()
{
   AT24Gate_Timer(InpLicenseKey);
   Step();
}

void OnTick() { Step(); }
