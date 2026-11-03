// Test helper: adds the Range Detector to the chart, waits for it to draw, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_Range_Detector");
   ChartIndicatorAdd(0, 0, h);
   Sleep(10000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "rd_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("RDSHOT done");
   Sleep(800);
  }
