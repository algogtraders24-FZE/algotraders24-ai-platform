// Test helper: adds Expected Range Bands to the chart, waits for it to draw, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   ChartSetInteger(0, CHART_SHIFT, true);
   ChartSetDouble(0, CHART_SHIFT_SIZE, 20.0);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_Expected_Range");
   ChartIndicatorAdd(0, 0, h);
   Sleep(10000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "er_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("ERSHOT done");
   Sleep(800);
  }
