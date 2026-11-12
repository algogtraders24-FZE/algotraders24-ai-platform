// Test helper: adds Setup Pro to an H1 chart (default inputs), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Setup_Pro");
   ChartIndicatorAdd(0, 0, h);
   Sleep(25000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "sp_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("SPSHOT done");
  }
