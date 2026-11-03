// Test helper: adds the Squeeze Meter to the chart in a sub-window, waits for it to draw, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\AT24_Squeeze_Meter");
   ChartIndicatorAdd(0, 1, h);
   Sleep(10000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "sq_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("SQSHOT done");
   Sleep(800);
  }
