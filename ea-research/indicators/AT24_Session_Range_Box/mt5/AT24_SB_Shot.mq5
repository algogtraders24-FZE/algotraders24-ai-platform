// Test helper: adds the Session Range Box to the chart, waits for it to draw, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   ChartSetInteger(0, CHART_SHIFT, true);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_Session_Range_Box");
   ChartIndicatorAdd(0, 0, h);
   Sleep(10000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "sb_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("SBSHOT done");
   Sleep(800);
  }
