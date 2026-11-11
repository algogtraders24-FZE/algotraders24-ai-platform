// Test helper: adds the Forward Ledger in REPLAY mode (from 2025-06-01, in-sample, not evidence), waits, saves a screenshot.
// iCustom parameter list: the input-group header counts as a slot, so the replay date is the 2nd parameter.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   ChartSetInteger(0, CHART_AUTOSCROLL, true);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Forward_Ledger", "", D'2025.06.01', 30, true);   // 4th slot = InpCalUtc (offline terminal calendar is UTC)
   ChartIndicatorAdd(0, 0, h);
   Sleep(45000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "fl_replay.png", 1280, 720, ALIGN_RIGHT);
   Print("FLSHOT replay done");
  }
