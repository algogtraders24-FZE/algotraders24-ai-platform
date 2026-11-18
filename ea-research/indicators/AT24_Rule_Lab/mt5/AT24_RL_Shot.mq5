// Test helper: adds Rule Lab to an H1 chart, prints the dashboard texts and buffers, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_SHOW_GRID, false);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\AT24_Rule_Lab", "", 20000, 30000, 2.0, "", true, 12000, "", true, false, false, "", true, false, CORNER_LEFT_UPPER, 10, 20);
   if(h == INVALID_HANDLE) { PrintFormat("RLSHOT FAIL handle err=%d", GetLastError()); return; }
   ChartIndicatorAdd(0, 0, h);
   Sleep(40000);
   ChartRedraw(0);
   Sleep(1500);
   string ids[] = {"st1", "rs0", "rf0", "rv0", "rs1", "rf1", "rv1", "rs2", "rf2", "rv2", "rs3", "rf3", "rv3", "rs4", "rf4", "rv4", "rs5", "rf5", "rv5", "g1", "a1", "a2", "a3", "a4"};
   for(int k = 0; k < ArraySize(ids); k++) { string nm = "AT24RL_" + ids[k]; if(ObjectFind(0, nm) >= 0) PrintFormat("RLSHOT %s: %s", ids[k], ObjectGetString(0, nm, OBJPROP_TEXT)); }
   for(int r = 0; r < 6; r++)
     {
      string line = "";
      for(int s = 0; s < 5; s++) line += ObjectGetString(0, "AT24RL_cv" + IntegerToString(r * 5 + s), OBJPROP_TEXT) + " (" + ObjectGetString(0, "AT24RL_cn" + IntegerToString(r * 5 + s), OBJPROP_TEXT) + ") | ";
      PrintFormat("RLSHOT row %d: %s", r, line);
     }
   ChartScreenShot(0, "rl_shot.png", 1400, 820, ALIGN_RIGHT);
   Print("RLSHOT done");
  }
