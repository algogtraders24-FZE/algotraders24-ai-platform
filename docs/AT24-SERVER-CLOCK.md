# AT24 Server Clock (shared MT5 helper)

File: `ea-research/indicators/_shared/AT24_ServerClock/mt5/AT24_ServerClock.mqh`.

```mql5
#include "AT24_ServerClock.mqh"
AT24SC_Clock clk; int meas[]; datetime utc[];
bool ok = AT24SC_Detect(_Symbol, clk, 60, meas, utc);     // once an hour, copies H1 history
datetime gmt = AT24SC_ToGmt(clk, serverTime);               // DST-aware; falls back to the live offset if !clk.ok
int offSec  = AT24SC_OffsetSecAtServer(clk, serverTime);
```
Rules: fixed, US daylight time, EU daylight time; base offset -12..+14. Test record and the independent Python check are next to the file. Source idea: MQL5 library post "BrokerClock" (code 78825).
