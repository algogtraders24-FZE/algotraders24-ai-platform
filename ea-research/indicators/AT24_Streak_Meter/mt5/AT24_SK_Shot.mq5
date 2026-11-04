// Test helper: adds Streak Meter to the chart (candle history is built on demand), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Streak_Meter");
   ChartIndicatorAdd(0, 0, h);
   Sleep(20000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "sk_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("SKSHOT done");
   Sleep(800);
  }
