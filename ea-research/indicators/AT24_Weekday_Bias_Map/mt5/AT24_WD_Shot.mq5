// Test helper: adds Weekday Bias Map to the chart (D1 history is built on demand), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Weekday_Bias_Map");
   ChartIndicatorAdd(0, 0, h);
   Sleep(50000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "wd_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("WDSHOT done");
   Sleep(800);
  }

