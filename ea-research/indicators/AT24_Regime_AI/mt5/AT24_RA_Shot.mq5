// Test helper: adds Regime AI to an H1 chart, prints the dashboard texts and buffers, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_SHOW_GRID, false);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\AT24_Regime_AI", "", 20000, 30000, "", false, false, "", true, false, CORNER_LEFT_UPPER, 10, 20);
   if(h == INVALID_HANDLE) { PrintFormat("RASHOT FAIL handle err=%d", GetLastError()); return; }
   ChartIndicatorAdd(0, 1, h);
   Sleep(20000);
   ChartRedraw(0);
   Sleep(1500);
   string ids[] = {"c2", "c3", "c4", "s00", "s01", "s02", "s03", "s04", "s40", "s41", "s42", "s43", "s44"};
   for(int k = 0; k < ArraySize(ids); k++)
     {
      string nm = "AT24RA_" + ids[k];
      if(ObjectFind(0, nm) >= 0) PrintFormat("RASHOT %s: %s", ids[k], ObjectGetString(0, nm, OBJPROP_TEXT));
     }
   double b2[], b3[], b4[];
   if(CopyBuffer(h, 2, 1, 1, b2) == 1 && CopyBuffer(h, 3, 1, 1, b3) == 1 && CopyBuffer(h, 4, 1, 1, b4) == 1)
      PrintFormat("RASHOT last closed bar buffers: state %.0f run %.0f ratio %.4f", b2[0], b3[0], b4[0]);
   ChartScreenShot(0, "ra_shot.png", 1400, 820, ALIGN_RIGHT);
   Print("RASHOT done");
  }
