//+------------------------------------------------------------------+
//| MT4 runtime test helper: runs the Round Levels indicator with its|
//| dashboard on, reads the level buffers and the statistics text    |
//| from the dashboard labels, and dumps them with the bars.         |
//+------------------------------------------------------------------+
double Rd(int b, int sh)
  {
   return iCustom(NULL, 0, "AT24Indicators\AT24_Round_Levels", 10.0, 50.0, 100.0, 6, 4, 3, 20, 1.0, 14, 8000, 8421504, 16760576, 55295, true, false, 0, 12, 24, false, false, b, sh);
  }
int OnInit()
  {
   int w = 0;
   while(iBars(NULL, 0) < 9000 && w < 90) { Sleep(1000); RefreshRates(); w++; }
   int n = MathMin(iBars(NULL, 0) - 1, 8000);
   int f = FileOpen("rn4_result.csv", FILE_WRITE | FILE_CSV, ',');
   FileWrite(f, "meta", n);
   for(int s = n; s >= 1; s--)
      FileWrite(f, "bar", (long)Time[s], DoubleToString(High[s], Digits), DoubleToString(Low[s], Digits), DoubleToString(Close[s], Digits));
   double x = Rd(0, 0);
   Sleep(5000);
   string row = "";
   for(int b = 0; b < 6; b++) row = row + DoubleToString(Rd(b, 0), 5) + ",";
   FileWrite(f, "lv", row, DoubleToString(Close[0], Digits));
   for(int k = 0; k < 3; k++)
      FileWrite(f, "txt", k, ObjectGetString(0, "AT24RN_s" + IntegerToString(k), OBJPROP_TEXT));
   FileClose(f);
   Print("RN4TEST done");
   return(INIT_SUCCEEDED);
  }
void OnTick() {}
