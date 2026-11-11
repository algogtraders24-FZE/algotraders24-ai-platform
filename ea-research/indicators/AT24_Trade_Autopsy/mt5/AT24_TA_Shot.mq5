// Test helper: adds Trade Autopsy with the built-in SAMPLE trades (the portable demo account has no history), waits, saves a screenshot.
// iCustom parameter list: each input-group header counts as a slot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 1);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_Trade_Autopsy", "", true, (long)-1, 0, PERIOD_M15, 16, 20, 12, true);
   ChartIndicatorAdd(0, 0, h);
   Sleep(15000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "ta_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("TASHOT done");
  }
