// Test helper: adds Hour Bias Map to the chart, waits for it to draw, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_Hour_Bias_Map");
   ChartIndicatorAdd(0, 0, h);
   Sleep(30000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "hb_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("HBSHOT done");
   Sleep(800);
  }

