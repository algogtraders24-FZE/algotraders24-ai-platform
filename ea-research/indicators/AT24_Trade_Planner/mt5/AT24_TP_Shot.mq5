// Test helper: adds Trade Planner (default first placement: 1.5 ATR stop, 2R target), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Trade_Planner");
   ChartIndicatorAdd(0, 0, h);
   Sleep(12000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "tp_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("TPSHOT done");
  }
