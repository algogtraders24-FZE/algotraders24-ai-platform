// Test helper: adds Correlation Shift Monitor with the pair that has daily history in the offline test terminal (XAUUSD real vs BTCUSD_T custom Binance data), waits, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Correlation_Shift", "", "XAUUSD:BTCUSD_T,XAUUSD:EURUSD,BTCUSD_T:US500");
   ChartIndicatorAdd(0, 0, h);
   Sleep(25000);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "cs_shot.png", 1280, 720, ALIGN_RIGHT);
   Print("CSSHOT done");
  }
