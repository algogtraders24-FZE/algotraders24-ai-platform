// Test helper: adds Sweep Scorecard to an H1 chart (history built on demand), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   ChartSetInteger(0, CHART_SHIFT, true);
   ChartSetDouble(0, CHART_SHIFT_SIZE, 10.0);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Sweep_Scorecard");
   ChartIndicatorAdd(0, 0, h);
   Sleep(45000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "sw_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("SWSHOT done");
  }
