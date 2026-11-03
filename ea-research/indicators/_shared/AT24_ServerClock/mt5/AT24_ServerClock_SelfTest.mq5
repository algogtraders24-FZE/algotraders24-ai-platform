//+------------------------------------------------------------------+
//| Self-test: detects the broker clock from H1 history and dumps    |
//| everything needed for an independent Python check.               |
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
void OnStart()
  {
   AT24SC_Clock c;
   int meas[]; datetime utc[];
   bool ok = AT24SC_Detect("XAUUSD", c, 60, meas, utc);
   PrintFormat("SCTEST ok=%d base=%d rule=%s hitsRecent=%d hitsAll=%d weeks=%d", ok, c.base, AT24SC_RuleName(c.rule), c.hitsRecent, c.hitsAll, c.weeks);
   int live = (int)(TimeTradeServer() - TimeGMT());
   PrintFormat("SCTEST live offset now = %d s, helper offset now = %d s", live, AT24SC_OffsetSecAtServer(c, TimeTradeServer()));
   int f = FileOpen("ServerClock_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", ok, c.base, c.rule, c.hitsRecent, c.hitsAll, c.weeks, live);
   for(int i = 0; i < ArraySize(meas); i++) FileWrite(f, "week", (long)utc[i], meas[i]);
   //--- conversion check on every 6th hour of the last 400 days
   datetime nowS = TimeTradeServer();
   for(int k = 0; k < 400 * 4; k++)
     {
      datetime s = nowS - (datetime)((long)k * 6 * 3600);
      FileWrite(f, "conv", (long)s, (long)AT24SC_ToGmt(c, s), AT24SC_OffsetSecAtServer(c, s));
     }
   FileClose(f);
   Print("SCTEST done");
  }
