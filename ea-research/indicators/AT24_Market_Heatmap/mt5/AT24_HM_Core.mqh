//+------------------------------------------------------------------+
//| AT24_HM_Core.mqh                                                 |
//| Market heatmap row from closed daily bars: percent changes,      |
//| ATR as a percent of price, EMA trend state, RSI, and where the   |
//| price sits in its 252-bar range. Pure maths, chronological.      |
//+------------------------------------------------------------------+
#ifndef AT24_HM_CORE_MQH
#define AT24_HM_CORE_MQH

#include "AT24_Pullback_Core.mqh"
#include "AT24_DV_Core.mqh"

struct AT24HM_Row
  {
   bool   ok;
   double last;        // last closed daily close
   double ch1, ch5, ch21;   // percent change over 1, 5, 21 closed bars
   double atrPct;      // ATR(14) as percent of the last close
   double moveAtr;     // last closed bar move (close - previous close) in ATR(14) of the previous bar, signed
   int    trend;       // +1 close > EMA50 > EMA200, -1 close < EMA50 < EMA200, else 0
   double rsi;         // Wilder RSI(14)
   double rangePos;    // 0..100: position of the last close between the lowest low and highest high of the last 252 bars
   double fromHigh;    // percent below the highest high of the last 252 bars (<= 0)
  };

void AT24HM_Calc(const int n, const double &open[], const double &high[], const double &low[], const double &close[], AT24HM_Row &r)
  {
   r.ok = false; r.last = 0.0; r.ch1 = r.ch5 = r.ch21 = 0.0; r.atrPct = 0.0; r.moveAtr = 0.0; r.trend = 0; r.rsi = 50.0; r.rangePos = 50.0; r.fromHigh = 0.0;
   if(n < 260) return;
   double e50[], e200[], at[], rs[];
   ArrayResize(e50, n); ArrayResize(e200, n); ArrayResize(at, n); ArrayResize(rs, n);
   AT24TP_Ema(n, close, 50, e50); AT24TP_Ema(n, close, 200, e200); AT24TP_Atr(n, high, low, close, 14, at); AT24DV_Rsi(n, close, 14, rs);
   int i = n - 1;
   r.last = close[i];
   r.ch1 = 100.0 * (close[i] / close[i - 1] - 1.0);
   r.ch5 = 100.0 * (close[i] / close[i - 5] - 1.0);
   r.ch21 = 100.0 * (close[i] / close[i - 21] - 1.0);
   r.atrPct = 100.0 * at[i] / close[i];
   r.moveAtr = at[i - 1] > 0.0 ? (close[i] - close[i - 1]) / at[i - 1] : 0.0;
   r.trend = (close[i] > e50[i] && e50[i] > e200[i]) ? 1 : ((close[i] < e50[i] && e50[i] < e200[i]) ? -1 : 0);
   r.rsi = rs[i];
   double hh = -1e300, ll = 1e300;
   for(int k = i - 251; k <= i; k++) { hh = MathMax(hh, high[k]); ll = MathMin(ll, low[k]); }
   r.rangePos = hh > ll ? 100.0 * (close[i] - ll) / (hh - ll) : 50.0;
   r.fromHigh = 100.0 * (close[i] / hh - 1.0);
   r.ok = true;
  }

#endif // AT24_HM_CORE_MQH
