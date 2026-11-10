// Test helper: Hour Bias Map with a MANUAL broker clock (winter GMT+2, US daylight rule) - proves the fallback path renders without detection.
// iCustom parameter list: group headers count as slots -> "", history days, "", DST aware, manual base, manual rule.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 3);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\\AT24_Hour_Bias_Map", "", 900, "", true, 2, 2);
   ChartIndicatorAdd(0, 0, h);
   Sleep(40000);
   ChartRedraw(0);
   Sleep(1000);
   ChartScreenShot(0, "hb_manual.png", 1280, 720, ALIGN_RIGHT);
   Print("HBMANUAL done");
  }
