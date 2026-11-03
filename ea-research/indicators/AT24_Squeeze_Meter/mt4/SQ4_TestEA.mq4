//+------------------------------------------------------------------+
//| MT4 runtime test helper: reads the Squeeze Meter buffers via     |
//| iCustom and dumps them with the bars for an independent check.   |
//+------------------------------------------------------------------+
double Rd(int b, int sh)
  {
   return iCustom(NULL, 0, "AT24Indicators\AT24_Squeeze_Meter", 20, 2.0, 20, 1.5, 14, 6, 20, 8000, false, false, 0, 12, 24, false, false, b, sh);
  }
int OnInit()
  {
   int w = 0;
   while(iBars(NULL, 0) < 9000 && w < 90) { Sleep(1000); RefreshRates(); w++; }
   int n = MathMin(iBars(NULL, 0) - 1, 8000);
   int f = FileOpen("sq4_result.csv", FILE_WRITE | FILE_CSV, ',');
   FileWrite(f, "meta", n);
   for(int s = n; s >= 1; s--)
      FileWrite(f, "bar", (long)Time[s], DoubleToString(High[s], Digits), DoubleToString(Low[s], Digits), DoubleToString(Close[s], Digits));
   double x = Rd(0, 1);
   Sleep(4000);
   for(int sh = 1; sh <= 400; sh++)
     {
      string row = "";
      for(int b = 0; b < 7; b++)
        {
         double v = Rd(b, sh);
         row = row + (v >= 1e9 ? "E" : DoubleToString(v, 5)) + ",";
        }
      FileWrite(f, "ind", sh, row);
     }
   FileClose(f);
   Print("SQ4TEST done");
   return(INIT_SUCCEEDED);
  }
void OnTick() {}
