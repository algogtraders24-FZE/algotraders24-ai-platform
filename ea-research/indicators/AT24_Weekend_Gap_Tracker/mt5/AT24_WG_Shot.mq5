// Test helper: adds Weekend Gap Tracker to the chart (H1 history is built on demand), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   ChartSetInteger(0, CHART_SHIFT, true);
   ChartSetDouble(0, CHART_SHIFT_SIZE, 20.0);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Weekend_Gap_Tracker");
   ChartIndicatorAdd(0, 0, h);
   Sleep(30000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "wg_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("WGSHOT done");
   Sleep(800);
  }
