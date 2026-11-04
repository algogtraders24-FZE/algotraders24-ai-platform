// Test helper: adds News Risk Clock to the chart, waits for the calendar to load, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   ChartSetInteger(0, CHART_SHIFT, true);
   ChartSetDouble(0, CHART_SHIFT_SIZE, 20.0);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_News_Risk_Clock", 1);   // 1 = calendar times are UTC (the test terminal has no broker login)
   ChartIndicatorAdd(0, 0, h);
   Sleep(25000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "nw_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("NWSHOT done");
   Sleep(800);
  }
