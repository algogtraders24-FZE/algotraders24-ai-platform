// Test helper: adds Position Map to an H4 chart (default inputs), waits, saves a screenshot and prints what the indicator buffers say.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_SHOW_GRID, false);
   int h = iCustom(_Symbol, PERIOD_H4, "AT24Indicators\AT24_Position_Map");
   if(h == INVALID_HANDLE) { Print("PMSHOT FAIL handle"); return; }
   ChartIndicatorAdd(0, 0, h);
   Sleep(30000);
   ChartRedraw(0);
   Sleep(1500);
   double b[8]; double v[1];
   string out = "";
   for(int i = 0; i < 8; i++) { if(CopyBuffer(h, i, 0, 1, v) == 1) out += StringFormat(" b%d=%.5f", i, v[0]); }
   Print("PMSHOT buffers:", out);
   ChartScreenShot(0, "pm_shot.png", 1400, 820, ALIGN_RIGHT);
   Print("PMSHOT done");
  }
