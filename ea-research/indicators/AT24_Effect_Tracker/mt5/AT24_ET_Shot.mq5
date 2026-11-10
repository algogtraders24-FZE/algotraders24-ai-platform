// Test helper: adds Effect Tracker to an H1 chart (history built on demand), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Effect_Tracker");
   ChartIndicatorAdd(0, 0, h);
   Sleep(45000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "et_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("ETSHOT done");
  }
