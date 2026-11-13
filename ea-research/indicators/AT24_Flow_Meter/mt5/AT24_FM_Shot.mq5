// Test helper: adds Flow Meter to an H1 chart (offline terminal: no ticks, so the bar proxy mode shows), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Flow_Meter");
   ChartIndicatorAdd(0, 1, h);
   Sleep(20000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "fm_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("FMSHOT done");
  }
