// Test helper: adds Strategy Fit to an H1 chart, prints the dashboard texts and buffers, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_SHOW_GRID, false);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\AT24_Strategy_Fit", "", 20000, 30000, "", true, false, false, "", true, false, CORNER_LEFT_UPPER, 10, 20);
   if(h == INVALID_HANDLE) { PrintFormat("SFSHOT FAIL handle err=%d", GetLastError()); return; }
   ChartIndicatorAdd(0, 0, h);
   Sleep(25000);
   ChartRedraw(0);
   Sleep(1500);
   string ids[] = {"st1", "rs0", "rf0", "rv0", "rs1", "rf1", "rv1", "rs2", "rf2", "rv2"};
   for(int k = 0; k < ArraySize(ids); k++)
     {
      string nm = "AT24SF_" + ids[k];
      if(ObjectFind(0, nm) >= 0) PrintFormat("SFSHOT %s: %s", ids[k], ObjectGetString(0, nm, OBJPROP_TEXT));
     }
   for(int r = 0; r < 3; r++)
     {
      string line = "";
      for(int s = 0; s < 5; s++)
        {
         string a = "AT24SF_cv" + IntegerToString(r * 5 + s), b = "AT24SF_cn" + IntegerToString(r * 5 + s);
         line += ObjectGetString(0, a, OBJPROP_TEXT) + " (" + ObjectGetString(0, b, OBJPROP_TEXT) + ") | ";
        }
      PrintFormat("SFSHOT row %d: %s", r, line);
     }
   double b0[], b3[];
   if(CopyBuffer(h, 0, 1, 1, b0) == 1 && CopyBuffer(h, 3, 1, 1, b3) == 1) PrintFormat("SFSHOT buffers last closed bar: trend signal %.0f, trend class %.0f", b0[0], b3[0]);
   ChartScreenShot(0, "sf_shot.png", 1400, 820, ALIGN_RIGHT);
   Print("SFSHOT done");
  }
