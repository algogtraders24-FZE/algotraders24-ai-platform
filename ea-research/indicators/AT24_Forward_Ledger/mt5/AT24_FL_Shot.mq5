// Test helper: adds the official Forward Ledger to the chart (H1 history is built on demand), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Forward_Ledger", "", (datetime)0, 30, true);
   ChartIndicatorAdd(0, 0, h);
   Sleep(45000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "fl_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("FLSHOT done");
  }
