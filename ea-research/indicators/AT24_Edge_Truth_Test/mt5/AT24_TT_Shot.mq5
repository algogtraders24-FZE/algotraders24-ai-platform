// Test helper: adds Edge Truth Test with the built-in SAMPLE list (the portable demo account has no history), waits, saves a screenshot.
// iCustom parameter list: each input-group header counts as a slot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Edge_Truth_Test", "", false, (long)-1, 0, 30, true);
   ChartIndicatorAdd(0, 0, h);
   Sleep(15000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "tt_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("TTSHOT done");
  }
