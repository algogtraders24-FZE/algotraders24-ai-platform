// Test helper: adds FVG Zones to the chart, waits for it to draw, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   ChartSetInteger(0, CHART_SHIFT, true);
   ChartSetDouble(0, CHART_SHIFT_SIZE, 20.0);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_FVG_Zones");
   ChartIndicatorAdd(0, 0, h);
   Sleep(10000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "fvg_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("FVSHOT done");
   Sleep(800);
  }
