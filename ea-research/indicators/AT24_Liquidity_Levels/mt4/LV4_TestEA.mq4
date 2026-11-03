//+------------------------------------------------------------------+
//| MT4 runtime test helper: reads the Liquidity Levels buffers via  |
//| iCustom and dumps them with the bars for an independent check.   |
//+------------------------------------------------------------------+
int OnInit()
  {
   int w = 0;
   while(iBars(NULL, 0) < 3000 && w < 90) { Sleep(1000); RefreshRates(); w++; }
   int n = MathMin(iBars(NULL, 0) - 1, 9000);
   int f = FileOpen("lv4_result.csv", FILE_WRITE | FILE_CSV, ',');
   FileWrite(f, "meta", n);
   for(int s = n; s >= 1; s--)
      FileWrite(f, "bar", (long)Time[s], DoubleToString(High[s], Digits), DoubleToString(Low[s], Digits), DoubleToString(Close[s], Digits));
   string nm = "AT24Indicators\AT24_Liquidity_Levels";
   double v0 = iCustom(NULL, 0, nm, true, true, 60, false, 0, 0, 0, 0, false, false, 0, 12, 24, false, false, 0, 0);
   Sleep(3000);
   string row = "";
   for(int b = 0; b < 6; b++)
     {
      double v = iCustom(NULL, 0, nm, true, true, 60, false, 0, 0, 0, 0, false, false, 0, 12, 24, false, false, b, 0);
      row = row + DoubleToString(v, 5) + ",";
     }
   FileWrite(f, "ind", row, (long)Time[0], Bars);
   FileClose(f);
   Print("LV4TEST done ", row);
   return(INIT_SUCCEEDED);
  }
void OnTick() {}
