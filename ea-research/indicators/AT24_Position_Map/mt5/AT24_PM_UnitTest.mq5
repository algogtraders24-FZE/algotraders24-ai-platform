//+------------------------------------------------------------------+
//| Hand-worked unit tests of the Position Map rules (SPEC.md).      |
//| Every case is a tiny series built by hand with the expected      |
//| answer worked out on paper first. Prints PASS / FAIL per case.   |
//+------------------------------------------------------------------+
#property script_show_inputs
#include "AT24_PM_Core.mqh"

int g_fail = 0;
void Check(const string name, const bool ok)
  {
   PrintFormat("PMUNIT %s  %s", ok ? "PASS" : "FAIL", name);
   if(!ok) g_fail++;
  }

// series: 20 flat warm-up bars (range 1, close 100, so ATR = 1) followed by the bars given as h/l/c triples
void Build(const double &sh[], const double &sl[], const double &sc[], const int m, double &h[], double &l[], double &c[], datetime &t[], int &n)
  {
   n = 20 + m;
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(t, n);
   for(int i = 0; i < 20; i++) { h[i] = 100.5; l[i] = 99.5; c[i] = 100.0; }
   for(int i = 0; i < m; i++) { h[20 + i] = sh[i]; l[20 + i] = sl[i]; c[20 + i] = sc[i]; }
   for(int i = 0; i < n; i++) t[i] = (datetime)(1700000000 + i * AT24PM_SEC_W1);
  }

void OnStart()
  {
   double h[], l[], c[], atr[]; datetime t[]; int n;
   AT24PM_Swing sw[];

   //--- A: a clean up structure. k = 1. swings: H105(bar 20) L98(22) H110(24) L101(26) H115(28)
   double ah[] = {105, 103, 102, 104, 110, 108, 106, 109, 115, 112};
   double al[] = {101, 100.5, 98, 99, 103, 104, 101, 102, 108, 108};
   double ac[] = {104, 101, 99, 103, 109, 105, 102, 108, 114, 110};
   Build(ah, al, ac, 10, h, l, c, t, n);
   AT24PM_Atr(n, h, l, c, atr);
   Check("ATR(14) of the flat warm-up is exactly 1", MathAbs(atr[19] - 1.0) < 1e-12 && atr[13] == 0.0 && atr[14] > 0.0);
   int cnt = AT24PM_Swings(n, h, l, c, atr, 1, 0.75, sw);
   Check("A: five swings found in order H L H L H", cnt == 5 && sw[0].type == 1 && sw[1].type == -1 && sw[2].type == 1 && sw[3].type == -1 && sw[4].type == 1);
   Check("A: swing prices 105, 98, 110, 101, 115 at bars 20, 22, 24, 26, 28", sw[0].price == 105 && sw[0].bar == 20 && sw[1].price == 98 && sw[1].bar == 22 && sw[2].price == 110 && sw[3].price == 101 && sw[4].price == 115 && sw[4].bar == 28);
   Check("A: a swing is known k bars after it formed (conf = bar + 1)", sw[0].conf == 21 && sw[4].conf == 29);
   int act[]; int m;
   m = AT24PM_LastActive(sw, cnt, 28, 8, act);
   Check("A: the swing at bar 28 is not visible at the close of bar 28, only at bar 29", m == 4 && sw[act[0]].bar == 26 && AT24PM_LastActive(sw, cnt, 29, 8, act) == 5);
   Check("A: trend at bar 29 is UP (highs 105 < 110 < 115, lows 98 < 101)", AT24PM_Trend(sw, cnt, 29) == 1);
   Check("A: trend before two highs and two lows are known is range (bar 24)", AT24PM_Trend(sw, cnt, 24) == 0);

   //--- A2: trend break needs a CLOSE below the last swing low (101): bar 30 wick to 99 but close 112 = still up; bar 31 close 100.5 = broken
   double bh[] = {105, 103, 102, 104, 110, 108, 106, 109, 115, 112, 111, 112};
   double bl[] = {101, 100.5, 98, 99, 103, 104, 101, 102, 108, 108, 99, 98.5};
   double bc[] = {104, 101, 99, 103, 109, 105, 102, 108, 114, 110, 112, 100.5};
   Build(bh, bl, bc, 12, h, l, c, t, n); AT24PM_Atr(n, h, l, c, atr); cnt = AT24PM_Swings(n, h, l, c, atr, 1, 0.75, sw);
   Check("A2: a wick below the higher low without a close below it does not end the trend", AT24PM_Trend(sw, cnt, 30) == 1);
   Check("A2: a close below the higher low ends it (range)", AT24PM_Trend(sw, cnt, 31) == 0);

   //--- B: equal highs are not a swing; an outside bar (higher high AND lower low than both neighbours) is not a swing
   double eh[] = {104, 105, 105, 103, 100.8, 100.6};
   double el[] = {100, 101, 101, 100, 99.8, 99.7};
   double ec[] = {103, 104, 104, 101, 100.2, 100.1};
   Build(eh, el, ec, 6, h, l, c, t, n); AT24PM_Atr(n, h, l, c, atr); cnt = AT24PM_Swings(n, h, l, c, atr, 1, 0.75, sw);
   bool anyHigh = false; for(int s = 0; s < cnt; s++) if(sw[s].type == 1 && (sw[s].bar == 21 || sw[s].bar == 22)) anyHigh = true;
   Check("B: two equal highs next to each other give no swing high", !anyHigh);
   double oh[] = {101, 108, 101.2, 101.1};
   double ol[] = {99.6, 95, 99.7, 99.6};
   double oc[] = {100.4, 100, 100.3, 100.2};
   Build(oh, ol, oc, 4, h, l, c, t, n); AT24PM_Atr(n, h, l, c, atr); cnt = AT24PM_Swings(n, h, l, c, atr, 1, 0.75, sw);
   Check("B2: an outside bar is both a high and a low candidate and is skipped", cnt == 0);

   //--- C: two highs in a row: the higher one stays and the lower one is marked replaced at the close of the bar where the higher one was confirmed
   double ch1[] = {105, 103, 103.6, 108, 105, 100.8, 100.6};
   double cl1[] = {101, 101.5, 102, 105, 103.4, 100, 99.8};
   double cc1[] = {104, 102, 103, 107, 104, 100.4, 100.2};
   Build(ch1, cl1, cc1, 7, h, l, c, t, n); AT24PM_Atr(n, h, l, c, atr); cnt = AT24PM_Swings(n, h, l, c, atr, 1, 0.75, sw);
   Check("C: the higher high replaces the first (no low in between), the replaced swing is marked at bar 24", cnt == 2 && sw[0].price == 105 && sw[0].repl == 24 && sw[1].price == 108 && sw[1].repl == AT24PM_INF);
   Check("C: before the replacement the first high is active, after it only the second", AT24PM_LastActive(sw, cnt, 23, 8, act) == 1 && sw[act[0]].price == 105 && AT24PM_LastActive(sw, cnt, 24, 8, act) == 1 && sw[act[0]].price == 108);

   //--- D: the same walk-forward trade four ways (entry 100, stop 98, target 104, risk 2, cost 0.10, swap 0.05 a day)
   double wh[] = {101, 105, 100.5, 101, 101};
   double wl[] = {99.5, 97, 99.5, 99.5, 99.5};
   double wc[] = {100.5, 104, 100.0, 100.2, 100.4};
   Build(wh, wl, wc, 5, h, l, c, t, n);
   int st, ex; double r;
   // bar 20: a bar that reaches neither; bar 21: high 105 and low 97 = both stop and target in one bar
   AT24PM_Walk(1, 100.0, 98.0, 104.0, 20, n, t, h, l, c, 8, 0.10, 0.05, st, ex, r);
   Check("D: stop and target in the same bar counts as the stop (long), exit at the stop", st == -1 && ex == 21 && MathAbs(r - (-1.0 - (0.10 + 0.05 * 7.0) / 2.0)) < 1e-12);
   AT24PM_Walk(-1, 100.0, 102.0, 96.0, 20, n, t, h, l, c, 8, 0.10, 0.05, st, ex, r);
   Check("D2: the mirror for a short: bar 21 high 105 reaches the stop at 102 first", st == -1 && ex == 21 && MathAbs(r - (-1.0 - (0.10 + 0.05 * 7.0) / 2.0)) < 1e-12);
   double wh2[] = {101, 104.5, 100.5};
   double wl2[] = {99.5, 100.2, 99.5};
   double wc2[] = {100.5, 104, 100.0};
   Build(wh2, wl2, wc2, 3, h, l, c, t, n);
   AT24PM_Walk(1, 100.0, 98.0, 104.0, 20, n, t, h, l, c, 8, 0.10, 0.05, st, ex, r);
   Check("D3: the target alone is paid at the target price: R = +2 minus cost", st == 1 && ex == 21 && MathAbs(r - (2.0 - (0.10 + 0.05 * 7.0) / 2.0)) < 1e-12);
   // time stop: nothing is touched for 8 weeks, then the close is used
   int mm = 9; double th[9], tl[9], tc[9];
   for(int i = 0; i < mm; i++) { th[i] = 101; tl[i] = 99.5; tc[i] = 100.5; }
   Build(th, tl, tc, mm, h, l, c, t, n);
   AT24PM_Walk(1, 100.0, 98.0, 104.0, 20, n, t, h, l, c, 8, 0.10, 0.05, st, ex, r);
   Check("D4: time stop after 8 weeks exits at the close of that bar (bar 28), R = 0.25 minus cost and 56 days of swap", st == 0 && ex == 28 && MathAbs(r - (0.5 / 2.0 - (0.10 + 0.05 * 56.0) / 2.0)) < 1e-12);
   AT24PM_Walk(1, 100.0, 98.0, 104.0, 20, 25, t, h, l, c, 8, 0.10, 0.05, st, ex, r);
   Check("D5: a trade that is not finished at the end of the data stays open", st == 2 && ex == -1 && r == 0.0);

   //--- E: the whole entry rule on one hand-built scenario (long) and its mirror (short)
   // W1: the up structure of case A (swings H105 L98 H110 L101 H115, known at bar 29): newest high 115, the low before it 101, leg = 14
   // H4: the weekly high 115 is made by H4 bar 22 (week of W1 bar 28); the pullback happens in week 30 at bars 104..116:
   //   P = 108.0 (bar 107), B = 111.0 (bar 109), higher low 109.0 (bar 111), the close 111.6 of bar 113 is above B = trigger, entry = open of bar 114 = 111.7
   //   depth = (115 - 108) / 14 = 0.5 (>= 0.382); measured move target = 108 + 14 = 122; stop = 108 - 0.25 * ATR(H4 at bar 113)
   Build(ah, al, ac, 10, h, l, c, t, n);
   double Wh[], Wl[], Wc[]; datetime Wt[]; int nW = n; ArrayCopy(Wh, h); ArrayCopy(Wl, l); ArrayCopy(Wc, c); ArrayCopy(Wt, t);
   int nH = 117;
   double Ho[], Hh[], Hl[], Hc[]; datetime Ht[]; ArrayResize(Ho, nH); ArrayResize(Hh, nH); ArrayResize(Hl, nH); ArrayResize(Hc, nH); ArrayResize(Ht, nH);
   datetime w28 = Wt[28];
   for(int i = 0; i < nH; i++) { Ht[i] = (datetime)((long)w28 + (long)(i - 20) * AT24PM_SEC_H4); Ho[i] = 112.0; Hh[i] = 112.25; Hl[i] = 111.75; Hc[i] = 112.0; }
   double pa[4][4] = { {112.0, 113.5, 111.8, 113.2}, {113.2, 114.5, 113.0, 114.3}, {114.3, 115.0, 114.0, 114.2}, {114.2, 114.4, 112.5, 112.8} };
   for(int i = 0; i < 4; i++) { Ho[20 + i] = pa[i][0]; Hh[20 + i] = pa[i][1]; Hl[20 + i] = pa[i][2]; Hc[20 + i] = pa[i][3]; }
   for(int i = 24; i < 104; i++) { Ho[i] = 112.5; Hh[i] = 112.75; Hl[i] = 112.25; Hc[i] = 112.5; }
   double pr[13][4] = { {112.5, 112.6, 111.0, 111.2}, {111.2, 111.4, 109.5, 109.8}, {109.8, 110.0, 108.4, 108.6}, {108.6, 109.0, 108.0, 108.2}, {108.2, 109.6, 108.3, 109.5},
                        {109.5, 111.0, 109.3, 110.6}, {110.6, 110.7, 109.4, 109.6}, {109.6, 110.0, 109.0, 109.8}, {109.8, 110.6, 109.4, 110.4}, {110.4, 111.8, 110.2, 111.6},
                        {111.7, 112.2, 111.2, 112.0}, {112.0, 112.3, 111.5, 112.1}, {112.1, 112.2, 111.6, 111.9} };
   for(int i = 0; i < 13; i++) { Ho[104 + i] = pr[i][0]; Hh[104 + i] = pr[i][1]; Hl[104 + i] = pr[i][2]; Hc[104 + i] = pr[i][3]; }
   AT24PM_Params pp;
   pp.kW = 1; pp.kD = 3; pp.kH = 1; pp.minSwingAtr = 0.75; pp.minRetrace = 0.382; pp.stopBufAtr = 0.25; pp.rr1 = 3.0; pp.rr2 = 4.0; pp.rr3 = 5.0; pp.timeStopWeeks = 8; pp.cost = 0.0; pp.swapLong = 0.0; pp.swapShort = 0.0;
   AT24PM_Plan pls[]; double atH[]; AT24PM_Atr(nH, Hh, Hl, Hc, atH);
   int np = AT24PM_Run(nW, Wt, Wh, Wl, Wc, nH, Ht, Ho, Hh, Hl, Hc, pp, pls);
   Check("E: exactly one setup is produced (no repeat trigger while the same higher low is in force)", np == 1);
   double slx = 108.0 - 0.25 * atH[113];
   double rk = 111.7 - slx;
   if(np == 1)
     {
      Check("E: long, trigger bar 113, entry bar 114", pls[0].dir == 1 && pls[0].trigIdx == 113 && pls[0].entryIdx == 114);
      Check("E: entry = open of the next bar (111.7), pullback low P = 108.0, B = 111.0", pls[0].entry == 111.7 && pls[0].pullback == 108.0 && pls[0].brkLevel == 111.0);
      Check("E: stop = P - 0.25 ATR(H4); risk = entry - stop", MathAbs(pls[0].sl - slx) < 1e-9 && MathAbs(pls[0].risk - rk) < 1e-9);
      Check("E: targets are entry + 3, 4 and 5 times the risk (1:3, 1:4, 1:5)", MathAbs(pls[0].tp[0] - (111.7 + 3 * rk)) < 1e-9 && MathAbs(pls[0].tp[1] - (111.7 + 4 * rk)) < 1e-9 && MathAbs(pls[0].tp[2] - (111.7 + 5 * rk)) < 1e-9);
      Check("E: nothing is hit in the bars that follow: all three targets still open", pls[0].status == 1 && pls[0].st[0] == 2 && pls[0].st[1] == 2 && pls[0].st[2] == 2 && pls[0].ex[0] == -1);
     }
   // bar 115 reaches 124: above target 1 (123.67) but below target 2 (127.66)
   double keepH = Hh[115]; Hh[115] = 124.0;
   np = AT24PM_Run(nW, Wt, Wh, Wl, Wc, nH, Ht, Ho, Hh, Hl, Hc, pp, pls);
   Check("E2: a bar that reaches 124 pays target 1 (+3 R at the target price, exit bar 115) and leaves targets 2 and 3 open", np == 1 && pls[0].st[0] == 1 && pls[0].ex[0] == 115 && MathAbs(pls[0].r[0] - 3.0) < 1e-9 && pls[0].st[1] == 2 && pls[0].st[2] == 2);
   Hh[115] = keepH;
   // bar 115 trades below the stop: all three targets lose exactly 1 R
   double keepL = Hl[115]; Hl[115] = 107.0;
   np = AT24PM_Run(nW, Wt, Wh, Wl, Wc, nH, Ht, Ho, Hh, Hl, Hc, pp, pls);
   Check("E2b: a bar below the stop ends all three targets at the stop: -1 R each, exit bar 115", np == 1 && pls[0].st[0] == -1 && pls[0].st[1] == -1 && pls[0].st[2] == -1 && pls[0].ex[2] == 115 && MathAbs(pls[0].r[0] + 1.0) < 1e-9 && MathAbs(pls[0].r[2] + 1.0) < 1e-9);
   Hl[115] = keepL;
   pp.minRetrace = 0.6; np = AT24PM_Run(nW, Wt, Wh, Wl, Wc, nH, Ht, Ho, Hh, Hl, Hc, pp, pls);
   Check("E3: a pullback of 50 percent is not enough when 60 percent is required: no setup", np == 0);
   pp.minRetrace = 0.382;
   // the mirror: every price p becomes 200 - p, highs and lows swap. Short, same bars, mirrored levels
   double Mwh[], Mwl[], Mwc[], Mho[], Mhh[], Mhl[], Mhc[];
   ArrayResize(Mwh, nW); ArrayResize(Mwl, nW); ArrayResize(Mwc, nW);
   for(int i = 0; i < nW; i++) { Mwh[i] = 200.0 - Wl[i]; Mwl[i] = 200.0 - Wh[i]; Mwc[i] = 200.0 - Wc[i]; }
   ArrayResize(Mho, nH); ArrayResize(Mhh, nH); ArrayResize(Mhl, nH); ArrayResize(Mhc, nH);
   for(int i = 0; i < nH; i++) { Mho[i] = 200.0 - Ho[i]; Mhh[i] = 200.0 - Hl[i]; Mhl[i] = 200.0 - Hh[i]; Mhc[i] = 200.0 - Hc[i]; }
   np = AT24PM_Run(nW, Wt, Mwh, Mwl, Mwc, nH, Ht, Mho, Mhh, Mhl, Mhc, pp, pls);
   Check("E4: the mirrored market gives exactly one SHORT setup at the same bars", np == 1 && pls[0].dir == -1 && pls[0].trigIdx == 113 && pls[0].entryIdx == 114);
   if(np == 1)
     {
      double slm = 92.0 + 0.25 * atH[113];
      double rm = slm - 88.3;
      Check("E4: entry 88.3, P = 92.0, B = 89.0, stop = P + 0.25 ATR", MathAbs(pls[0].entry - 88.3) < 1e-9 && MathAbs(pls[0].pullback - 92.0) < 1e-9 && MathAbs(pls[0].brkLevel - 89.0) < 1e-9 && MathAbs(pls[0].sl - slm) < 1e-9);
      Check("E4: the short targets are entry - 3, 4 and 5 times the risk", MathAbs(pls[0].tp[0] - (88.3 - 3 * rm)) < 1e-9 && MathAbs(pls[0].tp[1] - (88.3 - 4 * rm)) < 1e-9 && MathAbs(pls[0].tp[2] - (88.3 - 5 * rm)) < 1e-9);
     }

   PrintFormat("PMUNIT %s", g_fail == 0 ? "ALL PASSED" : "SOME FAILED");
  }
