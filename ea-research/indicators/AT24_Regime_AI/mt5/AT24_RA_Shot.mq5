// Test helper: adds Regime AI to an H1 chart, prints the dashboard texts, the arrows and the buffers, saves a screenshot.
void OnStart()
  {
   ChartSetInteger(0, CHART_SCALE, 2);
   ChartSetInteger(0, CHART_SHOW_GRID, false);
   int h = iCustom(_Symbol, PERIOD_H1, "AT24Indicators\AT24_Regime_AI", "", 20000, 30000, "", true, true, true, 2, 3, 0.75, 0.382, 0.25, 3.0, 8, true, 0, 0.5, 10, "", false, false, false, "", true, false, CORNER_LEFT_UPPER, 10, 20);
   if(h == INVALID_HANDLE) { PrintFormat("RASHOT FAIL handle err=%d", GetLastError()); return; }
   ChartIndicatorAdd(0, 1, h);
   Sleep(30000);
   ChartRedraw(0);
   Sleep(1500);
   string ids[] = {"c2", "c3", "c4", "c5", "b2", "b3", "b4", "p1", "p2", "p3", "mv0", "mv1", "mv2", "mv3", "mv4"};
   for(int k = 0; k < ArraySize(ids); k++)
     {
      string nm = "AT24RA_" + ids[k];
      if(ObjectFind(0, nm) >= 0) PrintFormat("RASHOT %s: %s", ids[k], ObjectGetString(0, nm, OBJPROP_TEXT));
     }
   int na = 0, nb = 0, ns = 0;
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
     {
      string n = ObjectName(0, i);
      if(StringFind(n, "AT24RA_ar") == 0) { na++; ENUM_OBJECT t = (ENUM_OBJECT)ObjectGetInteger(0, n, OBJPROP_TYPE); if(t == OBJ_ARROW_BUY) nb++; else ns++; }
      if(StringFind(n, "AT24RA_lv") == 0) PrintFormat("RASHOT %s = %s", n, DoubleToString(ObjectGetDouble(0, n, OBJPROP_PRICE), _Digits));
     }
   PrintFormat("RASHOT arrows %d (buy %d, sell %d)", na, nb, ns);
   double b2[], b5[], b6[], b7[], b8[];
   if(CopyBuffer(h, 6, 1, 1, b6) == 1 && CopyBuffer(h, 7, 1, 1, b7) == 1 && CopyBuffer(h, 8, 1, 1, b8) == 1) PrintFormat("RASHOT range buffers: mid %.5f lo %.5f hi %.5f", b6[0], b7[0], b8[0]);
   if(CopyBuffer(h, 2, 1, 1, b2) == 1 && CopyBuffer(h, 5, 1, 1, b5) == 1)
      PrintFormat("RASHOT last closed bar: state %.0f, plan direction buffer %.0f", b2[0], b5[0]);
   ChartScreenShot(0, "ra_shot.png", 1400, 820, ALIGN_RIGHT);
   ChartSetInteger(0, CHART_SCALE, 0);
   ChartNavigate(0, CHART_END, 0);
   ChartRedraw(0);
   Sleep(1500);
   ChartScreenShot(0, "ra_shot2.png", 1400, 820, ALIGN_RIGHT);
   Print("RASHOT done");
  }
