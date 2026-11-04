//+------------------------------------------------------------------+
//| AT24_SqueezeMeter_Licensed.mq5 - AT24 Squeeze Meter (MT5)          |
//| Licensed utility EA: loads the Squeeze Meter indicator (embedded  |
//| inside this file) into its own sub-window. It never places       |
//| orders. Context tool, not a signal.                              |
//| (c) algotraders24.ai                                             |
//+------------------------------------------------------------------+
#property copyright "algotraders24.ai"
#property link      "https://algotraders24.ai"
#property version   "1.01"
#property description "AT24 Squeeze Meter - Bollinger-inside-Keltner squeeze state, momentum and what price really did after past squeezes."
#property description "Licensed utility EA: it loads the indicator on your chart and never places orders."
#property description "Descriptive history. Not a signal. It does not say when to trade."

#define AT24_PRODUCT_ID "AT24-SQUEEZE-METER"
#include "AT24_LicenseGate.mqh"

#resource "\\Indicators\\AT24Lab\\SqueezeMeter\\AT24_Squeeze_Meter.ex5"

input string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)

#define RP_PATH "::Indicators\\AT24Lab\\SqueezeMeter\\AT24_Squeeze_Meter.ex5"

int    g_h   = INVALID_HANDLE;
int    g_win = -1;
string g_name = "";

bool AddIndicator()
  {
   if(g_h != INVALID_HANDLE)
      return true;
   ResetLastError();
   g_h = iCustom(_Symbol, _Period, RP_PATH);
   if(g_h == INVALID_HANDLE)
     {
      Print("AT24 Squeeze Meter: could not load the indicator, error ", GetLastError());
      return false;
     }
   int win = (int)ChartGetInteger(0, CHART_WINDOWS_TOTAL);       // a new sub-window below the existing ones
   if(!ChartIndicatorAdd(0, win, g_h))
     {
      Print("AT24 Squeeze Meter: could not add the indicator to the chart, error ", GetLastError());
      IndicatorRelease(g_h);
      g_h = INVALID_HANDLE;
      return false;
     }
   g_win  = win;
   g_name = ChartIndicatorName(0, win, 0);
   return true;
  }

void RemoveIndicator()
  {
   if(g_h == INVALID_HANDLE)
      return;
   if(g_win >= 0 && g_name != "")
      ChartIndicatorDelete(0, g_win, g_name);
   IndicatorRelease(g_h);
   g_h = INVALID_HANDLE;
   g_win = -1;
   g_name = "";
  }

int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey))
      return INIT_FAILED;
   if(!AddIndicator())
      return INIT_FAILED;
   EventSetTimer(1);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   RemoveIndicator();
   Comment("");
  }

void OnTimer()
  {
   AT24Gate_Timer(InpLicenseKey);
   if(!AT24Gate_Allowed())
      RemoveIndicator();           // licence refused later (revoked / moved to another account): the panel disappears, the gate shows why
  }

void OnTick() { }
