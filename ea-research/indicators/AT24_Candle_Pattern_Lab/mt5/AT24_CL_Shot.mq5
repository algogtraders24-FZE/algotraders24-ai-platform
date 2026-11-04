// Test helper: adds Candle Pattern Lab to the chart, waits for it to draw, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_Candle_Pattern_Lab");
   ChartIndicatorAdd(0, 0, h);
   Sleep(10000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "cl_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("CLSHOT done");
   Sleep(800);
  }
