//+------------------------------------------------------------------+
//| AT24_TradeAutopsy_Licensed.mq5 - AT24 Trade Autopsy (MT5)          |
//| Licensed utility EA: loads the Trade Autopsy indicator (embedded  |
//| inside this file) on the main chart window. It never places       |
//| orders. Context tool, not a signal.                              |
//| (c) algotraders24.ai                                             |
//+------------------------------------------------------------------+
#property copyright "algotraders24.ai"
#property link      "https://algotraders24.ai"
#property version   "1.01"
#property description "AT24 Trade Autopsy - draws your closed trades and measures how much of the best price each exit captured, from your own trade history."
#property description "Licensed utility EA: it loads the indicator on your chart and never places orders."
#property description "Descriptive history on your own broker data. Context tool, not a signal or a forecast."

#define AT24_PRODUCT_ID "AT24-TRADE-AUTOPSY"
#include "AT24_LicenseGate.mqh"

#resource "\\Indicators\\AT24Lab\\TradeAutopsy\\AT24_Trade_Autopsy.ex5"

input string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)

#define RP_PATH "::Indicators\\AT24Lab\\TradeAutopsy\\AT24_Trade_Autopsy.ex5"

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
      Print("AT24 Trade Autopsy: could not load the indicator, error ", GetLastError());
      return false;
     }
   int win = 0;                                                  // this indicator draws on the main chart window
   if(!ChartIndicatorAdd(0, win, g_h))
     {
      Print("AT24 Trade Autopsy: could not add the indicator to the chart, error ", GetLastError());
      IndicatorRelease(g_h);
      g_h = INVALID_HANDLE;
      return false;
     }
   g_win  = win;
   g_name = ChartIndicatorName(0, win, ChartIndicatorsTotal(0, win) - 1);
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
