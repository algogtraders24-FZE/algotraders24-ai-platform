// Test helper: adds Auto Fib Zones to the chart, waits for it to draw, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   ChartSetInteger(0, CHART_SHIFT, true);
   ChartSetDouble(0, CHART_SHIFT_SIZE, 30.0);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_Auto_Fib_Zones");
   ChartIndicatorAdd(0, 0, h);
   Sleep(10000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "fib_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("FBSHOT done");
   Sleep(800);
  }
