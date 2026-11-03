//+------------------------------------------------------------------+
//| MT4 runtime test helper: reads the Session Range Box buffers via |
//| iCustom and dumps them with the bars for an independent check.   |
//+------------------------------------------------------------------+
int OnInit()
  {
   int w = 0;
   while(iBars(NULL, 0) < 3000 && w < 90) { Sleep(1000); RefreshRates(); w++; }
   Print("SB4TEST waited ", w, "s bars=", iBars(NULL, 0));
   int n = MathMin(iBars(NULL, 0) - 1, 9000);
   int f = FileOpen("sb4_result.csv", FILE_WRITE | FILE_CSV, ',');
   FileWrite(f, "meta", n);
   for(int s = n; s >= 1; s--)
      FileWrite(f, "bar", (long)Time[s], DoubleToString(High[s], Digits), DoubleToString(Low[s], Digits), DoubleToString(Close[s], Digits));
   string nm = "AT24Indicators\\AT24_Session_Range_Box";
   double hi = iCustom(NULL, 0, nm, 0, 7, 21, 0.0, 60, 10, false, 0, 0, 0, 0, 0, false, false, 0, 12, 24, false, false, 0, 0);
   Sleep(3000);
   hi = iCustom(NULL, 0, nm, 0, 7, 21, 0.0, 60, 10, false, 0, 0, 0, 0, 0, false, false, 0, 12, 24, false, false, 0, 0);
   double lo = iCustom(NULL, 0, nm, 0, 7, 21, 0.0, 60, 10, false, 0, 0, 0, 0, 0, false, false, 0, 12, 24, false, false, 1, 0);
   double bk = iCustom(NULL, 0, nm, 0, 7, 21, 0.0, 60, 10, false, 0, 0, 0, 0, 0, false, false, 0, 12, 24, false, false, 2, 0);
   double hd = iCustom(NULL, 0, nm, 0, 7, 21, 0.0, 60, 10, false, 0, 0, 0, 0, 0, false, false, 0, 12, 24, false, false, 3, 0);
   double rt = iCustom(NULL, 0, nm, 0, 7, 21, 0.0, 60, 10, false, 0, 0, 0, 0, 0, false, false, 0, 12, 24, false, false, 4, 0);
   FileWrite(f, "ind", DoubleToString(hi, 5), DoubleToString(lo, 5), DoubleToString(bk, 0), DoubleToString(hd, 0), DoubleToString(rt, 5), (long)Time[0], Bars);
   FileClose(f);
   Print("SB4TEST done hi=", hi, " lo=", lo, " brk=", bk);
   return(INIT_SUCCEEDED);
  }
void OnTick() {}
