// Test helper: adds the Strategy Fit Scanner to an H1 chart, lets it read the symbols, prints the table and the debug rows, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_SHOW_GRID, false);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\AT24_Strategy_Fit_Scanner", "", "XAUUSD,EURUSD,GBPUSD,USDJPY,USDCHF,US30", "", "", 20000, "", 12, false, "", false, false, "", true, false, true, CORNER_LEFT_UPPER, 10, 20);
   if(h == INVALID_HANDLE) { PrintFormat("SFSSHOT FAIL handle err=%d", GetLastError()); return; }
   ChartIndicatorAdd(0, 0, h);
   Sleep(60000);
   ChartRedraw(0);
   Sleep(1500);
   for(int k = 0; k < 12; k++)
     {
      string id = IntegerToString(k), line = "";
      for(int c = 0; c < 7; c++) { string nm = "AT24SFS_a" + IntegerToString(c) + id; if(ObjectFind(0, nm) >= 0) line += ObjectGetString(0, nm, OBJPROP_TEXT) + " | "; }
      PrintFormat("SFSSHOT row %d: %s", k, line);
     }
   ObjectGetString(0, "AT24SFS_t4", OBJPROP_TEXT);
   PrintFormat("SFSSHOT header: %s", ObjectGetString(0, "AT24SFS_t4", OBJPROP_TEXT));
   double b0[]; if(CopyBuffer(h, 0, 0, 1, b0) == 1) PrintFormat("SFSSHOT buffer 0 (FIT signals) = %.0f", b0[0]);
   ChartScreenShot(0, "sfs_shot.png", 1400, 820, ALIGN_RIGHT);
   Print("SFSSHOT done");
  }
