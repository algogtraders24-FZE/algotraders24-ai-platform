// Test helper: adds Absorption Map to an H1 chart (default inputs), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Absorption_Map");
   ChartIndicatorAdd(0, 0, h);
   Sleep(20000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "ab_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("ABSHOT done");
  }
