// Test helper: adds Analog Finder to an H1 chart, prints the dashboard texts and buffers, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_SHOW_GRID, false);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\AT24_Analog_Finder", "", 12000, "", true, "", true, false, CORNER_LEFT_UPPER, 10, 20);
   if(h == INVALID_HANDLE) { PrintFormat("AFSHOT FAIL handle err=%d", GetLastError()); return; }
   ChartIndicatorAdd(0, 0, h);
   Sleep(25000);
   ChartRedraw(0);
   Sleep(1500);
   string ids[] = {"l1", "l2", "l4", "l5", "l6", "r2", "r3", "s1", "s2", "s3"};
   for(int k = 0; k < ArraySize(ids); k++) { string nm = "AT24AF_" + ids[k]; if(ObjectFind(0, nm) >= 0) PrintFormat("AFSHOT %s: %s", ids[k], ObjectGetString(0, nm, OBJPROP_TEXT)); }
   string hc = ""; for(int b = 0; b < 10; b++) hc += ObjectGetString(0, "AT24AF_hc" + IntegerToString(b), OBJPROP_TEXT) + " ";
   PrintFormat("AFSHOT histogram counts: %s", hc);
   int mk = 0; for(int i = ObjectsTotal(0) - 1; i >= 0; i--) if(StringFind(ObjectName(0, i), "AT24AF_mk") == 0) mk++;
   PrintFormat("AFSHOT markers: %d", mk);
   double b0[], b1[], b2[], b3[];
   if(CopyBuffer(h, 0, 1, 1, b0) == 1 && CopyBuffer(h, 1, 1, 1, b1) == 1 && CopyBuffer(h, 2, 1, 1, b2) == 1 && CopyBuffer(h, 3, 1, 1, b3) == 1) PrintFormat("AFSHOT buffers: median %.5f q10 %.5f q90 %.5f up %.3f", b0[0], b1[0], b2[0], b3[0]);
   ChartScreenShot(0, "af_shot.png", 1400, 820, ALIGN_RIGHT);
   Print("AFSHOT done");
  }
