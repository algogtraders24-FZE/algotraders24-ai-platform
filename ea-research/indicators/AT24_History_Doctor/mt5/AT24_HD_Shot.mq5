// Test helper: adds History Doctor to an H1 chart (history built on demand), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_History_Doctor");
   ChartIndicatorAdd(0, 0, h);
   Sleep(30000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "hd_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("HDSHOT done");
  }
