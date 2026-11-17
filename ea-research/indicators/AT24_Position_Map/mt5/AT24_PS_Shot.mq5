// Test helper: adds Position Scanner to an H4 chart with the same history as the Position Map defaults, lets it read every symbol, prints the table and saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_SHOW_GRID, false);
   int h = iCustom(_Symbol, PERIOD_H4, "AT24Indicators\AT24_Position_Scanner",
                   "", "XAUUSD,EURUSD,GBPUSD,USDJPY,US30", "", "", 2, 3, 0.75, 0.382, 0.25, 3.0, 8, true, "", 7000, 520, "", false, false, false, "", true, false, true, CORNER_LEFT_UPPER, 12, 24);
   if(h == INVALID_HANDLE) { PrintFormat("PSSHOT FAIL handle err=%d", GetLastError()); return; }
   ChartIndicatorAdd(0, 0, h);
   Sleep(40000);
   ChartRedraw(0);
   Sleep(1500);
   for(int k = 0; k < 5; k++)
     {
      string line = "";
      for(int c = 0; c < 8; c++)
        {
         string nm = "AT24PS_r" + IntegerToString(c) + IntegerToString(k);
         if(ObjectFind(0, nm) >= 0) line += ObjectGetString(0, nm, OBJPROP_TEXT) + " | ";
        }
      PrintFormat("PSSHOT row %d: %s", k, line);
     }
   ChartScreenShot(0, "ps_shot.png", 1400, 820, ALIGN_RIGHT);
   Print("PSSHOT done");
  }
