//+------------------------------------------------------------------+
//| AT24_EA_Core_SelfTest_EA.mq5                                     |
//| Strategy Tester wrapper: runs the self-test once on the first    |
//| tick, then stops the test. No orders are sent.                   |
//+------------------------------------------------------------------+
#property version "1.00"
#include "../Include/AT24_EA_Core_SelfTest.mqh"

input double InpRiskPercent = 1.0;
input double InpSLPoints    = 500;

bool g_done = false;

void OnTick()
  {
   if(g_done) return;
   g_done = true;
   AT24_RunSelfTest(InpRiskPercent, InpSLPoints);
   TesterStop();
  }
