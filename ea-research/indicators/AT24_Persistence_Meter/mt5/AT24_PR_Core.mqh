//+------------------------------------------------------------------+
//| AT24_PR_Core.mqh                                                 |
//| Persistence of price moves: Lo-MacKinlay variance ratio VR(q).   |
//| VR > 1 = moves tend to continue (trending), VR < 1 = moves tend  |
//| to reverse (mean-reverting), VR ~ 1 = random walk. Plus a study  |
//| of whether the reading really predicted what the next move did.  |
//| Closed bars only. Pure maths, chronological arrays.              |
//+------------------------------------------------------------------+
#ifndef AT24_PR_CORE_MQH
#define AT24_PR_CORE_MQH

//--- variance ratio of the log returns r[end-W+1 .. end] for horizon q. vr, z (homoskedastic z-statistic). false if not enough data.
bool AT24PR_Vr(const double &r[], const int end, const int W, const int q, double &vr, double &z)
  {
   vr = 1.0; z = 0.0;
   if(q < 2 || W < q * 4 || end - W + 1 < 0) return false;
   int a = end - W + 1;
   double mu = 0.0;
   for(int i = a; i <= end; i++) mu += r[i];
   mu /= W;
   double s1 = 0.0;
   for(int i = a; i <= end; i++) s1 += (r[i] - mu) * (r[i] - mu);
   double va = s1 / (W - 1);
   double m = (double)q * (W - q + 1) * (1.0 - (double)q / W);
   double sq = 0.0;
   for(int k = a + q - 1; k <= end; k++)
     {
      double s = 0.0;
      for(int j = 0; j < q; j++) s += r[k - j];
      s -= q * mu;
      sq += s * s;
     }
   double vc = sq / m;
   if(va <= 0.0) return false;
   vr = vc / va;
   double phi = 2.0 * (2.0 * q - 1.0) * (q - 1.0) / (3.0 * q * W);
   z = (vr - 1.0) / MathSqrt(phi);
   return true;
  }

//--- Hurst-style exponent implied by the variance ratio: VR(q) ~ q^(2H-1)  =>  H = 0.5 + ln(VR) / (2 ln q)
double AT24PR_Hurst(const double vr, const int q)
  {
   if(vr <= 0.0 || q < 2) return 0.5;
   return 0.5 + MathLog(vr) / (2.0 * MathLog((double)q));
  }

//--- log returns of closes (r[0] = 0)
void AT24PR_Returns(const int n, const double &c[], double &r[])
  {
   ArrayResize(r, n);
   r[0] = 0.0;
   for(int i = 1; i < n; i++) r[i] = MathLog(c[i] / c[i - 1]);
  }

//--- study: at bar t (stride `stride`, from W+q+H), classify by z at horizon q over the last W returns:
//--- TREND z >= zc, MEAN-REVERT z <= -zc, else RANDOM. Outcome: does the next H-bar return have the SAME sign as the previous H-bar return?
//--- out[0..3] samples ALL/TREND/MEANREV/RANDOM, out[4..7] % same-sign for those four groups
void AT24PR_Study(const int n, const double &c[], const double &r[], const int W, const int q, const int H, const int stride, const double zc, double &out[])
  {
   ArrayResize(out, 8);
   for(int z = 0; z < 8; z++) out[z] = 0.0;
   int cnt[4], same[4];
   for(int k = 0; k < 4; k++) { cnt[k] = 0; same[k] = 0; }
   for(int t = W + H; t + H < n; t += stride)
     {
      double vr, zs;
      if(!AT24PR_Vr(r, t, W, q, vr, zs)) continue;
      double prev = MathLog(c[t] / c[t - H]), next = MathLog(c[t + H] / c[t]);
      if(prev == 0.0 || next == 0.0) continue;
      bool ok = ((prev > 0.0) == (next > 0.0));
      int g = (zs >= zc) ? 1 : ((zs <= -zc) ? 2 : 3);
      cnt[0]++; if(ok) same[0]++;
      cnt[g]++; if(ok) same[g]++;
     }
   for(int k = 0; k < 4; k++) { out[k] = cnt[k]; out[4 + k] = cnt[k] > 0 ? 100.0 * same[k] / cnt[k] : 0.0; }
  }

#endif // AT24_PR_CORE_MQH
