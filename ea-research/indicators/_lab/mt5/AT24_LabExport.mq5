//+------------------------------------------------------------------+
//| AT24 Research Lab - data export (test helper, no trading).        |
//| Writes OHLC + tick volume + spread (server time and GMT) for      |
//| M15 / H1 / D1, and the high-impact USD calendar (with actual /    |
//| forecast / previous values) to MQL5\Files for the Python lab.     |
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"

void ExportTf(const string sym, const ENUM_TIMEFRAMES tf, const string name, const int want, const AT24SC_Clock &clk)
  {
   MqlRates r[];
   int n = CopyRates(sym, tf, 1, want, r);
   if(n < 100) { PrintFormat("LABEXP %s FAIL bars=%d", name, n); return; }
   int f = FileOpen(name, FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "time", "gmt", "open", "high", "low", "close", "tickvol", "spread");
   for(int i = 0; i < n; i++)
      FileWrite(f, (long)r[i].time, (long)AT24SC_ToGmt(clk, r[i].time), DoubleToString(r[i].open, 3), DoubleToString(r[i].high, 3), DoubleToString(r[i].low, 3), DoubleToString(r[i].close, 3), (long)r[i].tick_volume, (int)r[i].spread);
   FileClose(f);
   PrintFormat("LABEXP %s bars=%d first=%s last=%s", name, n, TimeToString(r[0].time), TimeToString(r[n - 1].time));
  }

void OnStart()
  {
   string sym = "XAUUSD";
   SymbolSelect(sym, true);
   AT24SC_Clock clk; int meas[]; datetime utc[];
   if(!AT24SC_Detect(sym, clk, 60, meas, utc)) { Print("LABEXP FAIL clock"); return; }
   ExportTf(sym, PERIOD_M15, "lab_xauusd_m15.csv", 30000, clk);
   ExportTf(sym, PERIOD_H1, "lab_xauusd_h1.csv", 40000, clk);
   ExportTf(sym, PERIOD_D1, "lab_xauusd_d1.csv", 6000, clk);
   //--- calendar: the test terminal has no broker login, so calendar times are UTC-based (TimeTradeServer = UTC); convert to GMT then record both
   long tsOff = (long)MathRound((double)(TimeTradeServer() - TimeGMT()) / 1800.0) * 1800;
   MqlCalendarValue v[];
   datetime from = D'2023.01.01', to = TimeTradeServer() + 3 * 86400;
   int cn = CalendarValueHistory(v, from, to, NULL, "USD");
   int f = FileOpen("lab_usd_events.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "gmt", "importance", "event_id", "actual", "forecast", "previous", "name");
   int kept = 0;
   for(int i = 0; i < cn; i++)
     {
      MqlCalendarEvent e;
      if(!CalendarEventById(v[i].event_id, e) || (int)e.importance < 2) continue;
      long gmt = (long)v[i].time - tsOff;
      string a = v[i].HasActualValue() ? DoubleToString(v[i].GetActualValue(), 6) : "";
      string fc = v[i].HasForecastValue() ? DoubleToString(v[i].GetForecastValue(), 6) : "";
      string pv = v[i].HasPreviousValue() ? DoubleToString(v[i].GetPreviousValue(), 6) : "";
      string nm = e.name; StringReplace(nm, ",", " ");
      FileWrite(f, gmt, (int)e.importance, (long)v[i].event_id, a, fc, pv, nm);
      kept++;
     }
   FileClose(f);
   PrintFormat("LABEXP events calendar=%d kept(imp>=2)=%d tsOff=%d", cn, kept, (int)tsOff);
   Print("LABEXP done");
  }
