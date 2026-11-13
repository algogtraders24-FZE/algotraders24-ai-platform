// Test helper: adds Market Heatmap with the symbols that have daily history in the offline test terminal (XAUUSD real, BTCUSD_T custom Binance data, EURUSD cached), waits, saves a screenshot.
// iCustom parameter list: each input-group header counts as a slot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Market_Heatmap", "", "XAUUSD,EURUSD,BTCUSD_T,US500,USOIL");
   ChartIndicatorAdd(0, 0, h);
   Sleep(35000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "hm_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("HMSHOT done");
  }
