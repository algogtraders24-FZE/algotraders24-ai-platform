// Test helper: adds Setup Scanner with the two symbols that have history in the offline test terminal (XAUUSD real, BTCUSD_T custom Binance data), waits, saves a screenshot.
// iCustom parameter list: each input-group header counts as a slot (watchlist, timeframe, ...).
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Setup_Scanner", "", "XAUUSD,BTCUSD_T,EURUSD,US500", PERIOD_H1);
   ChartIndicatorAdd(0, 0, h);
   Sleep(30000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "ss_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("SSSHOT done");
  }
