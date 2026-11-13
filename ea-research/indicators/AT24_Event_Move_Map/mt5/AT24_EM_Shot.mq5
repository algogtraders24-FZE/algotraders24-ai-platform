// Test helper: adds Event Move Map (calendar times used as given), waits, saves a screenshot.
// iCustom parameter list: each input-group header counts as a slot (currencies, window, days ahead, calendar UTC, alerts, clock).
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   int h = iCustom(_Symbol, PERIOD_M15, "AT24Indicators\\AT24_Event_Move_Map", "", "USD", 60, 7, false);   // calendar times are used as given (server time): on this offline terminal today they already equal server time
   ChartIndicatorAdd(0, 0, h);
   Sleep(30000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "em_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("EMSHOT done");
  }
