//+------------------------------------------------------------------+
//| AT24_PM_Core.mqh                                                 |
//| Position Map engine (rules: ../SPEC.md). Weekly structure gives  |
//| the direction, a pullback into it is measured, and an H4 higher  |
//| low + break of the last lower high is the trigger. Every rule    |
//| uses CLOSED bars only: a swing is known k bars after it formed,  |
//| a trend break needs a CLOSE beyond the level. Pure maths on      |
//| chronological arrays (index 0 = oldest). Descriptive, no orders. |
//+------------------------------------------------------------------+
#ifndef AT24_PM_CORE_MQH
#define AT24_PM_CORE_MQH

#include "AT24_TT_Core.mqh"

#define AT24PM_INF  2147483647
#define AT24PM_SEC_W1  604800
#define AT24PM_SEC_D1  86400
#define AT24PM_SEC_H4  14400
#define AT24PM_ATR_N   14

struct AT24PM_Swing
  {
   int    bar;      // bar of the swing extreme
   int    conf;     // bar at whose close the swing became known (bar + k)
   int    type;     // +1 swing high, -1 swing low
   double price;
   int    repl;     // bar at whose close a more extreme swing of the same type replaced it (AT24PM_INF if never)
   int    brk;      // first bar whose CLOSE went beyond the swing (below a low, above a high), -1 if none
  };

struct AT24PM_Params
  {
   int    kW, kD, kH;        // swing bars on each side: W1, D1, H4
   double minSwingAtr;       // smallest swing, in ATR(14) of its timeframe
   double minRetrace;        // smallest pullback depth as a share of the leg (0.382)
   double stopBufAtr;        // stop buffer in ATR(14) of H4
   double minRR;             // smallest reward to risk
   int    timeStopWeeks;
   double cost;              // round-turn spread, price units
   double swapLong;          // holding cost per calendar day, price units (positive = cost)
   double swapShort;
  };

struct AT24PM_Plan
  {
   int    dir;        // +1 long, -1 short
   int    trigIdx;    // H4 bar that closed beyond B
   int    entryIdx;   // trigIdx + 1 (-1 when that bar does not exist yet)
   double entry, sl, tp, risk, rr;
   double pullback;   // P: lowest low (long) or highest high (short) of the pullback
   double brkLevel;   // B
   int    status;     // 1 target, -1 stop, 0 timed out, 2 still open, 3 trigger on the last bar (entry next bar), -2 reward too small, -3 no room (measured move already reached), -4 stop not below entry
   int    exitIdx;
   double r;          // result in R after cost (0 while open or rejected)
   double rCtl;       // the same geometry traded the other way (control)
  };

struct AT24PM_Score
  {
   int    n;
   int    wins;
   double hitPct, avgR, sumR, t, pFlip;
   int    open;
   int    rejected;
  };

struct AT24PM_Life
  {
   int    nUp, nDown;
   double medWeeksUp, medWeeksDown;
   int    pbUpN, pbDownN;
   double pbUpMedPct, pbDownMedPct, pbUpMedAtr, pbDownMedAtr;
   double pbUpOver382, pbDownOver382, pbUpOver618, pbDownOver618, pbUpBroke, pbDownBroke;
  };

//--- ATR(14): simple mean of the last 14 true ranges; 0 for the first 14 bars
void AT24PM_Atr(const int n, const double &high[], const double &low[], const double &close[], double &atr[])
  {
   ArrayResize(atr, n);
   double tr[]; ArrayResize(tr, n);
   for(int i = 0; i < n; i++)
     {
      atr[i] = 0.0;
      if(i == 0) { tr[i] = high[i] - low[i]; continue; }
      tr[i] = MathMax(high[i] - low[i], MathMax(MathAbs(high[i] - close[i - 1]), MathAbs(low[i] - close[i - 1])));
     }
   for(int i = AT24PM_ATR_N; i < n; i++)
     {
      double s = 0.0;
      for(int j = i - AT24PM_ATR_N + 1; j <= i; j++) s += tr[j];
      atr[i] = s / AT24PM_ATR_N;
     }
  }

//--- confirmed swings of one timeframe (SPEC 1). Swing i is known at close of bar bar+k.
int AT24PM_Swings(const int n, const double &high[], const double &low[], const double &close[], const double &atr[],
                  const int k, const double minAtr, AT24PM_Swing &sw[])
  {
   ArrayResize(sw, 0);
   int cnt = 0, last = -1;
   for(int c = MathMax(k, AT24PM_ATR_N); c <= n - 1 - k; c++)
     {
      bool isH = true, isL = true;
      for(int q = c - k; q <= c + k; q++)
        {
         if(q == c) continue;
         if(high[q] >= high[c]) isH = false;
         if(low[q] <= low[c]) isL = false;
        }
      if(isH == isL) continue;                    // neither, or both (an outside bar): not a swing
      int type = isH ? 1 : -1;
      double price = isH ? high[c] : low[c];
      int conf = c + k;
      bool add = false;
      if(last < 0) add = true;
      else if(sw[last].type == type)
        {
         if((type > 0 && price > sw[last].price) || (type < 0 && price < sw[last].price)) { sw[last].repl = conf; add = true; }
        }
      else if(MathAbs(price - sw[last].price) >= minAtr * atr[c]) add = true;
      if(!add) continue;
      ArrayResize(sw, cnt + 1);
      sw[cnt].bar = c; sw[cnt].conf = conf; sw[cnt].type = type; sw[cnt].price = price; sw[cnt].repl = AT24PM_INF; sw[cnt].brk = -1;
      last = cnt; cnt++;
     }
   for(int s = 0; s < cnt; s++)
     {
      for(int j = sw[s].bar + 1; j < n; j++)
        {
         if((sw[s].type < 0 && close[j] < sw[s].price) || (sw[s].type > 0 && close[j] > sw[s].price)) { sw[s].brk = j; break; }
        }
     }
   return cnt;
  }

//--- the newest `want` swings that are known and not replaced at the close of bar i, newest first (indices into sw)
int AT24PM_LastActive(const AT24PM_Swing &sw[], const int cnt, const int i, const int want, int &out[])
  {
   ArrayResize(out, want);
   int m = 0;
   for(int s = cnt - 1; s >= 0 && m < want; s--)
     {
      if(sw[s].conf > i) continue;
      if(sw[s].repl <= i) continue;
      out[m++] = s;
     }
   return m;
  }

//--- trend at the close of bar i (SPEC 2): +1 up, -1 down, 0 range
int AT24PM_Trend(const AT24PM_Swing &sw[], const int cnt, const int i)
  {
   int a[]; int m = AT24PM_LastActive(sw, cnt, i, 8, a);
   int hA = -1, hB = -1, lA = -1, lB = -1;
   for(int p = 0; p < m; p++)
     {
      int s = a[p];
      if(sw[s].type > 0) { if(hA < 0) hA = s; else if(hB < 0) hB = s; }
      else               { if(lA < 0) lA = s; else if(lB < 0) lB = s; }
     }
   if(hA < 0 || hB < 0 || lA < 0 || lB < 0) return 0;
   bool up = (sw[hA].price > sw[hB].price) && (sw[lA].price > sw[lB].price);
   bool dn = (sw[hA].price < sw[hB].price) && (sw[lA].price < sw[lB].price);
   if(up) return (sw[lA].brk >= 0 && sw[lA].brk <= i) ? 0 : 1;
   if(dn) return (sw[hA].brk >= 0 && sw[hA].brk <= i) ? 0 : -1;
   return 0;
  }

//--- largest j with t[j] + period <= T (bar j is closed by time T), -1 if none
int AT24PM_LastClosed(const int n, const datetime &t[], const int period, const datetime T)
  {
   int best = -1;
   for(int j = 0; j < n; j++)
     {
      if((long)t[j] + period <= (long)T) best = j; else break;
     }
   return best;
  }

//--- first index with t[j] >= T, n if none
int AT24PM_FirstAtOrAfter(const int n, const datetime &t[], const datetime T)
  {
   for(int j = 0; j < n; j++) if((long)t[j] >= (long)T) return j;
   return n;
  }

//--- walk one trade forward from the bar after the trigger: stop first when both are hit in one bar, then target, then the time stop at the close
void AT24PM_Walk(const int dir, const double entry, const double sl, const double tp, const int entryIdx, const int n,
                 const datetime &t[], const double &high[], const double &low[], const double &close[],
                 const int timeStopWeeks, const double cost, const double swapPerDay, int &status, int &exitIdx, double &r)
  {
   status = 2; exitIdx = -1; r = 0.0;
   double risk = MathAbs(entry - sl);
   if(risk <= 0.0) return;
   for(int j = entryIdx; j < n; j++)
     {
      bool slHit = (dir > 0) ? (low[j] <= sl) : (high[j] >= sl);
      bool tpHit = (dir > 0) ? (high[j] >= tp) : (low[j] <= tp);
      double exitPx = 0.0; int st = 2;
      if(slHit) { st = -1; exitPx = sl; }
      else if(tpHit) { st = 1; exitPx = tp; }
      else if((long)t[j] - (long)t[entryIdx] >= (long)timeStopWeeks * AT24PM_SEC_W1) { st = 0; exitPx = close[j]; }
      if(st != 2)
        {
         double days = ((double)((long)t[j] - (long)t[entryIdx])) / AT24PM_SEC_D1;
         status = st; exitIdx = j;
         r = dir * (exitPx - entry) / risk - (cost + swapPerDay * days) / risk;
         return;
        }
     }
  }

//--- the full scan (SPEC 3-5): every setup the rules produce on the loaded history, walked forward on the real bars
int AT24PM_Run(const int nW, const datetime &tW[], const double &hW[], const double &lW[], const double &cW[],
               const int nH, const datetime &tH[], const double &oH[], const double &hH[], const double &lH[], const double &cH[],
               const AT24PM_Params &p, AT24PM_Plan &out[])
  {
   ArrayResize(out, 0);
   double atrW[], atrH[];
   AT24PM_Atr(nW, hW, lW, cW, atrW); AT24PM_Atr(nH, hH, lH, cH, atrH);
   AT24PM_Swing swW[], swH[];
   int cW_ = AT24PM_Swings(nW, hW, lW, cW, atrW, p.kW, p.minSwingAtr, swW);
   int cH_ = AT24PM_Swings(nH, hH, lH, cH, atrH, p.kH, p.minSwingAtr, swH);
   int cnt = 0;
   int busyLong = -1, busyShort = -1;       // last bar of the plan still running (no new plan on that side before it)
   int usedLong = -1, usedShort = -1;       // swing bar of the last higher/lower low or high that fired a trigger
   for(int h = 0; h < nH; h++)
     {
      if(atrH[h] <= 0.0) continue;
      datetime T = (datetime)((long)tH[h] + AT24PM_SEC_H4);
      int jw = AT24PM_LastClosed(nW, tW, AT24PM_SEC_W1, T);
      if(jw < 0) continue;
      int trend = AT24PM_Trend(swW, cW_, jw);
      if(trend == 0) continue;
      int dir = trend;
      if(dir > 0 && h <= busyLong) continue;
      if(dir < 0 && h <= busyShort) continue;
      int wa[]; int wm = AT24PM_LastActive(swW, cW_, jw, 8, wa);
      // newest swing of the trend side (high for a long) and the opposite swing right before it
      int pos = -1;
      for(int q = 0; q < wm; q++) if(swW[wa[q]].type == dir) { pos = q; break; }
      if(pos < 0 || pos + 1 >= wm) continue;
      int sNew = wa[pos], sLeg = wa[pos + 1];
      if(swW[sLeg].type != -dir) continue;
      double legTop = swW[sNew].price, legBase = swW[sLeg].price;      // long: high H, base L ; short: low and the high before it (mirrored by dir)
      double legLen = dir * (legTop - legBase);
      if(legLen <= 0.0) continue;
      // anchor: the H4 bar that made the weekly extreme (first bar of the highest high / lowest low inside that week)
      datetime wStart = tW[swW[sNew].bar];
      int a0 = AT24PM_FirstAtOrAfter(nH, tH, wStart);
      int anchor = -1; double ext = 0.0;
      for(int j = a0; j <= h && (long)tH[j] < (long)wStart + AT24PM_SEC_W1; j++)
        {
         double v = (dir > 0) ? hH[j] : -lH[j];
         if(anchor < 0 || v > ext) { anchor = j; ext = v; }
        }
      if(anchor < 0 || anchor >= h) continue;
      double P = (dir > 0) ? lH[anchor + 1] : hH[anchor + 1];
      for(int j = anchor + 1; j <= h; j++) P = (dir > 0) ? MathMin(P, lH[j]) : MathMax(P, hH[j]);
      double depth = (dir > 0) ? (legTop - P) / legLen : (P - legTop) / legLen;     // long: (H-P)/(H-L); short: (P-L)/(H-L), legTop = the low
      if(depth < p.minRetrace) continue;
      // H4 structure: higher low (long) / lower high (short) and the swing B right before it
      int ha[]; int hm = AT24PM_LastActive(swH, cH_, h, 6, ha);
      int ps = -1;
      for(int q = 0; q < hm; q++) if(swH[ha[q]].type == -dir) { ps = q; break; }
      if(ps < 0 || ps + 2 >= hm) continue;
      int sA = ha[ps], sB = ha[ps + 1], sPrev = ha[ps + 2];
      if(swH[sB].type != dir || swH[sPrev].type != -dir) continue;
      bool turned = (dir > 0) ? (swH[sA].price > swH[sPrev].price) : (swH[sA].price < swH[sPrev].price);
      if(!turned) continue;
      if(swH[sA].bar <= anchor || swH[sB].bar <= anchor) continue;
      bool brokeB = (dir > 0) ? (cH[h] > swH[sB].price) : (cH[h] < swH[sB].price);
      if(!brokeB) continue;
      if(dir > 0 && swH[sA].bar == usedLong) continue;
      if(dir < 0 && swH[sA].bar == usedShort) continue;
      if(dir > 0) usedLong = swH[sA].bar; else usedShort = swH[sA].bar;
      AT24PM_Plan pl;
      pl.dir = dir; pl.trigIdx = h; pl.entryIdx = (h + 1 < nH) ? h + 1 : -1;
      pl.entry = 0.0; pl.sl = 0.0; pl.tp = 0.0; pl.risk = 0.0; pl.rr = 0.0; pl.pullback = P; pl.brkLevel = swH[sB].price;
      pl.status = 3; pl.exitIdx = -1; pl.r = 0.0; pl.rCtl = 0.0;
      double entryPx = (pl.entryIdx >= 0) ? oH[pl.entryIdx] : cH[h];
      pl.entry = entryPx;
      pl.sl = (dir > 0) ? P - p.stopBufAtr * atrH[h] : P + p.stopBufAtr * atrH[h];
      pl.risk = dir * (entryPx - pl.sl);
      if(pl.risk <= 0.0) pl.status = -4;
      // target (SPEC 5.5): the measured move, the last weekly leg repeated from the pullback extreme (AB = CD)
      if(pl.status != -4)
        {
         double tp = P + dir * legLen;
         if(dir * (tp - entryPx) <= 0.0) pl.status = -3;            // the measured move is already reached: no room left
         else
           {
            pl.tp = tp; pl.rr = dir * (tp - entryPx) / pl.risk;
            if(pl.rr < p.minRR) pl.status = -2;
           }
        }
      if(pl.status == 3 && pl.entryIdx >= 0)
        {
         int st, ex; double r, rc;
         double swp = (dir > 0) ? p.swapLong : p.swapShort;
         double swpC = (dir > 0) ? p.swapShort : p.swapLong;
         AT24PM_Walk(dir, pl.entry, pl.sl, pl.tp, pl.entryIdx, nH, tH, hH, lH, cH, p.timeStopWeeks, p.cost, swp, st, ex, r);
         pl.status = st; pl.exitIdx = ex; pl.r = r;
         double slC = pl.entry + dir * pl.risk, tpC = pl.entry - dir * pl.rr * pl.risk;
         int st2, ex2;
         AT24PM_Walk(-dir, pl.entry, slC, tpC, pl.entryIdx, nH, tH, hH, lH, cH, p.timeStopWeeks, p.cost, swpC, st2, ex2, rc);
         pl.rCtl = rc;
         int until = (ex >= 0) ? ex : nH;
         if(dir > 0) busyLong = until; else busyShort = until;
        }
      ArrayResize(out, cnt + 1); out[cnt] = pl; cnt++;
     }
   return cnt;
  }

//--- score of the accepted, resolved plans (SPEC 7): result in R after cost, sign-flip luck test, and the control traded the other way
void AT24PM_ScoreOf(const AT24PM_Plan &pl[], const int cnt, const uint seed, const bool control, AT24PM_Score &sc)
  {
   sc.n = 0; sc.wins = 0; sc.hitPct = 0.0; sc.avgR = 0.0; sc.sumR = 0.0; sc.t = 0.0; sc.pFlip = 1.0; sc.open = 0; sc.rejected = 0;
   double rs[]; ArrayResize(rs, cnt); int m = 0;
   for(int i = 0; i < cnt; i++)
     {
      if(pl[i].status < 0 && pl[i].status != -1) { sc.rejected++; continue; }
      if(pl[i].status == 2 || pl[i].status == 3) { sc.open++; continue; }
      double v = control ? pl[i].rCtl : pl[i].r;
      rs[m++] = v;
      if(v > 0.0) sc.wins++;
     }
   sc.n = m;
   if(m < 2) { if(m == 1) { sc.sumR = rs[0]; sc.avgR = rs[0]; } return; }
   AT24TT_Res r; ArrayResize(rs, m);
   AT24TT_Run(rs, m, seed, r);
   sc.sumR = r.total; sc.avgR = r.mean; sc.t = r.t; sc.pFlip = r.pFlip; sc.hitPct = 100.0 * sc.wins / m;
  }

double AT24PM_Median(const double &v[], const int m)
  {
   if(m <= 0) return 0.0;
   double c[]; ArrayResize(c, m);
   for(int i = 0; i < m; i++) c[i] = v[i];
   ArraySort(c);
   return (m % 2 == 1) ? c[m / 2] : 0.5 * (c[m / 2 - 1] + c[m / 2]);
  }

//--- trend life (SPEC 8) from the final weekly swing chain: leg durations, pullback depths, how often a pullback ended the trend
void AT24PM_LifeOf(const AT24PM_Swing &sw[], const int cnt, const datetime &t[], const double &atr[], AT24PM_Life &L)
  {
   int ch[]; ArrayResize(ch, cnt); int m = 0;
   for(int s = 0; s < cnt; s++) if(sw[s].repl == AT24PM_INF) ch[m++] = s;
   double wUp[], wDn[], pU[], pD[], aU[], aD[];
   ArrayResize(wUp, m); ArrayResize(wDn, m); ArrayResize(pU, m); ArrayResize(pD, m); ArrayResize(aU, m); ArrayResize(aD, m);
   int nu = 0, nd = 0, pu = 0, pd = 0, u382 = 0, d382 = 0, u618 = 0, d618 = 0, ub = 0, db = 0;
   for(int i = 0; i + 1 < m; i++)
     {
      AT24PM_Swing A = sw[ch[i]], B = sw[ch[i + 1]];
      double weeks = ((double)((long)t[B.bar] - (long)t[A.bar])) / AT24PM_SEC_W1;
      if(A.type < 0) wUp[nu++] = weeks; else wDn[nd++] = weeks;
      if(i + 2 >= m) continue;
      AT24PM_Swing C = sw[ch[i + 2]];
      double leg = MathAbs(B.price - A.price);
      if(leg <= 0.0) continue;
      double depth = MathAbs(B.price - C.price);
      double pct = 100.0 * depth / leg;
      double dAtr = (atr[C.bar] > 0.0) ? depth / atr[C.bar] : 0.0;
      if(A.type < 0)
        {
         pU[pu] = pct; aU[pu] = dAtr; pu++;
         if(pct >= 38.2) u382++;
         if(pct >= 61.8) u618++;
         if(C.price < A.price) ub++;
        }
      else
        {
         pD[pd] = pct; aD[pd] = dAtr; pd++;
         if(pct >= 38.2) d382++;
         if(pct >= 61.8) d618++;
         if(C.price > A.price) db++;
        }
     }
   L.nUp = nu; L.nDown = nd; L.pbUpN = pu; L.pbDownN = pd;
   L.medWeeksUp = AT24PM_Median(wUp, nu); L.medWeeksDown = AT24PM_Median(wDn, nd);
   L.pbUpMedPct = AT24PM_Median(pU, pu); L.pbDownMedPct = AT24PM_Median(pD, pd);
   L.pbUpMedAtr = AT24PM_Median(aU, pu); L.pbDownMedAtr = AT24PM_Median(aD, pd);
   L.pbUpOver382 = (pu > 0) ? 100.0 * u382 / pu : 0.0; L.pbDownOver382 = (pd > 0) ? 100.0 * d382 / pd : 0.0;
   L.pbUpOver618 = (pu > 0) ? 100.0 * u618 / pu : 0.0; L.pbDownOver618 = (pd > 0) ? 100.0 * d618 / pd : 0.0;
   L.pbUpBroke = (pu > 0) ? 100.0 * ub / pu : 0.0;      L.pbDownBroke = (pd > 0) ? 100.0 * db / pd : 0.0;
  }

#endif // AT24_PM_CORE_MQH
