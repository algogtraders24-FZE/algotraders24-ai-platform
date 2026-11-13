//+------------------------------------------------------------------+
//| AT24_CS_Core.mqh                                                 |
//| Correlation shift between two instruments: the daily-return      |
//| correlation over a short and a long window, and where the short  |
//| one sits in its own history. Daily bars are matched by calendar  |
//| day (crypto weekends, holidays drop out). Pure maths.            |
//+------------------------------------------------------------------+
#ifndef AT24_CS_CORE_MQH
#define AT24_CS_CORE_MQH

struct AT24CS_Row
  {
   bool   ok;
   int    n;           // matched daily returns
   double corrS;       // correlation over the last `shortW` returns
   double corrL;       // correlation over the last `longW` returns
   double delta;       // corrS - corrL
   double pct;         // percentile (0..100) of corrS among all rolling short-window correlations of the last `histN` returns
  };

//--- match two daily series by calendar day (time / 86400); outputs the matched closes, chronological
int AT24CS_Align(const int na, const datetime &ta[], const double &ca[], const int nb, const datetime &tb[], const double &cb[], double &oa[], double &ob[])
  {
   ArrayResize(oa, 0); ArrayResize(ob, 0);
   int i = 0, j = 0, m = 0;
   while(i < na && j < nb)
     {
      long da = (long)ta[i] / 86400, db = (long)tb[j] / 86400;
      if(da == db) { ArrayResize(oa, m + 1); ArrayResize(ob, m + 1); oa[m] = ca[i]; ob[m] = cb[j]; m++; i++; j++; }
      else if(da < db) i++;
      else j++;
     }
   return m;
  }

double AT24CS_Corr(const double &x[], const double &y[], const int from, const int len)
  {
   double sx = 0, sy = 0;
   for(int i = from; i < from + len; i++) { sx += x[i]; sy += y[i]; }
   double mx = sx / len, my = sy / len, sxx = 0, syy = 0, sxy = 0;
   for(int i = from; i < from + len; i++) { double a = x[i] - mx, b = y[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
   return (sxx > 0.0 && syy > 0.0) ? sxy / MathSqrt(sxx * syy) : 0.0;
  }

void AT24CS_Calc(const double &ca[], const double &cb[], const int m, const int shortW, const int longW, const int histN, AT24CS_Row &r)
  {
   r.ok = false; r.n = 0; r.corrS = 0.0; r.corrL = 0.0; r.delta = 0.0; r.pct = 50.0;
   if(m < longW + 10) return;
   int nr = m - 1;
   double ra[], rb[]; ArrayResize(ra, nr); ArrayResize(rb, nr);
   for(int i = 1; i < m; i++) { ra[i - 1] = MathLog(ca[i] / ca[i - 1]); rb[i - 1] = MathLog(cb[i] / cb[i - 1]); }
   r.n = nr;
   r.corrS = AT24CS_Corr(ra, rb, nr - shortW, shortW);
   r.corrL = AT24CS_Corr(ra, rb, nr - longW, longW);
   r.delta = r.corrS - r.corrL;
   int h0 = MathMax(0, nr - histN), cnt = 0, below = 0;
   for(int e = h0 + shortW; e <= nr; e++)
     {
      double c = AT24CS_Corr(ra, rb, e - shortW, shortW);
      cnt++; if(c < r.corrS - 1e-12) below++;
     }
   r.pct = cnt > 0 ? 100.0 * below / cnt : 50.0;
   r.ok = true;
  }

#endif // AT24_CS_CORE_MQH
