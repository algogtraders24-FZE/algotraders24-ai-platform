//+------------------------------------------------------------------+
//| AT24_RA_Core.mqh - AT24 Regime AI engine (pure functions)        |
//| Features, nearest-centroid state, own-history statistics.        |
//| All arrays are chronological: index 0 = oldest bar.              |
//| Rules: see SPEC.md. No look-ahead: a state at bar i uses bars    |
//| <= i only. Forward range is used for statistics, never a state.  |
//+------------------------------------------------------------------+
#ifndef AT24_RA_CORE_MQH
#define AT24_RA_CORE_MQH

#define AT24RA_K        5
#define AT24RA_NF       4
#define AT24RA_FIRST    99      // first valid bar index
#define AT24RA_FWD      24      // forward window in bars
#define AT24RA_MINN     200     // fewest bars per state for a ratio

const double AT24RA_MU[AT24RA_NF] = {0.163863, -0.031967, 1.014311, 5.525808};
const double AT24RA_SD[AT24RA_NF] = {0.119898, 0.26684, 0.766584, 1.932356};
// centroids in raw units: er, lvol, slope, rngx
const double AT24RA_CENT[AT24RA_K][AT24RA_NF] =
  {
   {0.1023, 0.1663, 0.6141, 4.3468},    // 0 NOISY
   {0.1219, -0.2405, 1.3098, 7.4327},   // 1 WIDE SWING
   {0.3395, -0.1325, 2.6010, 9.4282},   // 2 STRONG MOVE
   {0.1197, -0.2249, 0.4958, 4.6743},   // 3 COMPRESSED
   {0.2955, 0.1396, 1.5741, 5.6380}     // 4 STEADY TREND
  };

string AT24RA_Name(const int s)
  {
   switch(s)
     {
      case 0: return "NOISY";
      case 1: return "WIDE SWING";
      case 2: return "STRONG MOVE";
      case 3: return "COMPRESSED";
      case 4: return "STEADY TREND";
     }
   return "-";
  }

//--- 1 = next 24 h range tends to be above average, -1 = below (pooled out-of-sample, see SPEC)
int AT24RA_PooledClass(const int s)
  {
   if(s == 0 || s == 4) return -1;
   if(s == 1 || s == 2 || s == 3) return 1;
   return 0;
  }

struct AT24RA_Stat
  {
   int    n[AT24RA_K];         // bars per state (all valid bars)
   int    nf[AT24RA_K];        // bars per state with a known forward range
   double share[AT24RA_K];
   double meanRun[AT24RA_K];
   double pStay[AT24RA_K];
   double ratio[AT24RA_K];     // mean forward range of the state / mean forward range of all; 0 = no claim
   double allFwd;              // mean forward range, all bars
   int    nAll;
  };

//--- features for all bars. out arrays are resized to n; invalid bars hold 0 and valid[] = false
void AT24RA_Features(const int n, const double &h[], const double &l[], const double &c[],
                     double &atr14[], double &er[], double &lvol[], double &slope[], double &rngx[], bool &valid[])
  {
   ArrayResize(atr14, n); ArrayResize(er, n); ArrayResize(lvol, n); ArrayResize(slope, n); ArrayResize(rngx, n); ArrayResize(valid, n);
   double tr[], ema[], dif[];
   ArrayResize(tr, n); ArrayResize(ema, n); ArrayResize(dif, n);
   for(int i = 0; i < n; i++)
     {
      tr[i] = h[i] - l[i];
      if(i > 0) tr[i] = MathMax(tr[i], MathMax(MathAbs(h[i] - c[i - 1]), MathAbs(l[i] - c[i - 1])));
      dif[i] = (i > 0) ? MathAbs(c[i] - c[i - 1]) : 0.0;
      ema[i] = (i == 0) ? c[0] : (2.0 / 21.0) * c[i] + (1.0 - 2.0 / 21.0) * ema[i - 1];
     }
   double s14 = 0.0, s100 = 0.0, sd48 = 0.0;
   for(int i = 0; i < n; i++)
     {
      s14 += tr[i]; if(i >= 14) s14 -= tr[i - 14];
      s100 += tr[i]; if(i >= 100) s100 -= tr[i - 100];
      sd48 += dif[i]; if(i >= 48) sd48 -= dif[i - 48];
      valid[i] = false; atr14[i] = 0.0; er[i] = 0.0; lvol[i] = 0.0; slope[i] = 0.0; rngx[i] = 0.0;
      if(i < AT24RA_FIRST) continue;
      double a14 = s14 / 14.0, a100 = s100 / 100.0;
      if(a14 <= 0.0 || a100 <= 0.0) continue;
      double den = sd48;                    // sum of |dC| over bars i-47..i (dif[0] excluded by construction for i>=48)
      er[i] = (den > 0.0) ? MathAbs(c[i] - c[i - 48]) / den : 0.0;
      lvol[i] = MathLog(a14 / a100);
      slope[i] = MathMin(6.0, MathAbs(ema[i] - ema[i - 10]) / a14);
      double hh = h[i], ll = l[i];
      for(int j = i - 23; j < i; j++) { if(h[j] > hh) hh = h[j]; if(l[j] < ll) ll = l[j]; }
      rngx[i] = MathMin(30.0, (hh - ll) / a14);
      atr14[i] = a14;
      valid[i] = true;
     }
  }

//--- nearest centroid in z space; lower index wins a tie
int AT24RA_Classify(const double f1, const double f2, const double f3, const double f4)
  {
   double f[AT24RA_NF]; f[0] = f1; f[1] = f2; f[2] = f3; f[3] = f4;
   int best = 0; double bd = DBL_MAX;
   for(int k = 0; k < AT24RA_K; k++)
     {
      double d = 0.0;
      for(int q = 0; q < AT24RA_NF; q++)
        {
         double z = (f[q] - AT24RA_MU[q]) / AT24RA_SD[q];
         double zc = (AT24RA_CENT[k][q] - AT24RA_MU[q]) / AT24RA_SD[q];
         d += (z - zc) * (z - zc);
        }
      if(d < bd - 1e-12) { bd = d; best = k; }
     }
   return best;
  }

//--- state of every bar (-1 before the first valid bar)
void AT24RA_States(const int n, const double &er[], const double &lvol[], const double &slope[], const double &rngx[], const bool &valid[], int &st[])
  {
   ArrayResize(st, n);
   for(int i = 0; i < n; i++) st[i] = valid[i] ? AT24RA_Classify(er[i], lvol[i], slope[i], rngx[i]) : -1;
  }

//--- forward range in ATR14 units: (max H(i+1..i+24) - min L(i+1..i+24)) / ATR14_i ; -1 when unknown
void AT24RA_Forward(const int n, const double &h[], const double &l[], const double &atr14[], const bool &valid[], double &fr[])
  {
   ArrayResize(fr, n);
   for(int i = 0; i < n; i++)
     {
      fr[i] = -1.0;
      if(!valid[i] || i + AT24RA_FWD >= n) continue;
      double hh = h[i + 1], ll = l[i + 1];
      for(int j = i + 2; j <= i + AT24RA_FWD; j++) { if(h[j] > hh) hh = h[j]; if(l[j] < ll) ll = l[j]; }
      fr[i] = (hh - ll) / atr14[i];
     }
  }

//--- statistics over bars from index 'from' (>= first valid) to n-1
void AT24RA_Stats(const int n, const int from, const int &st[], const double &fr[], AT24RA_Stat &s)
  {
   for(int k = 0; k < AT24RA_K; k++) { s.n[k] = 0; s.nf[k] = 0; s.share[k] = 0.0; s.meanRun[k] = 0.0; s.pStay[k] = 0.0; s.ratio[k] = 0.0; }
   s.allFwd = 0.0; s.nAll = 0;
   double sumf[AT24RA_K]; ArrayInitialize(sumf, 0.0);
   int stay[AT24RA_K], trans[AT24RA_K], runs[AT24RA_K]; long runLen[AT24RA_K];
   for(int k = 0; k < AT24RA_K; k++) { stay[k] = 0; trans[k] = 0; runs[k] = 0; runLen[k] = 0; }
   double sumAll = 0.0; int total = 0; int cur = 0;
   int i0 = MathMax(from, AT24RA_FIRST);
   for(int i = i0; i < n; i++)
     {
      int k = st[i]; if(k < 0) continue;
      s.n[k]++; total++;
      if(fr[i] >= 0.0) { s.nf[k]++; sumf[k] += fr[i]; sumAll += fr[i]; s.nAll++; }
      if(i + 1 < n && st[i + 1] >= 0) { trans[k]++; if(st[i + 1] == k) stay[k]++; }
      if(i == i0 || st[i - 1] != k) { runs[k]++; cur = 1; } else cur++;
      runLen[k]++;
     }
   if(s.nAll > 0) s.allFwd = sumAll / s.nAll;
   for(int k = 0; k < AT24RA_K; k++)
     {
      if(total > 0) s.share[k] = (double)s.n[k] / total;
      if(runs[k] > 0) s.meanRun[k] = (double)runLen[k] / runs[k];
      if(trans[k] > 0) s.pStay[k] = (double)stay[k] / trans[k];
      if(s.nf[k] >= AT24RA_MINN && s.allFwd > 0.0) s.ratio[k] = (sumf[k] / s.nf[k]) / s.allFwd;
     }
  }

//--- length of the current run ending at bar 'last'
int AT24RA_RunLen(const int &st[], const int last)
  {
   if(last < 0 || st[last] < 0) return 0;
   int r = 1;
   while(last - r >= 0 && st[last - r] == st[last]) r++;
   return r;
  }

#endif
