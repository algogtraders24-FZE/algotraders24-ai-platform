//+------------------------------------------------------------------+
//| AT24_EA_Core_SelfTest.mq5                                        |
//| Drag onto a chart of a DEMO account. Sends NO orders: runs the   |
//| pure helpers and the full pre-flight (incl. OrderCheck) and      |
//| prints a PASS/FAIL line per check to the Experts log.            |
//+------------------------------------------------------------------+
#property script_show_inputs
#property version "1.00"
#include "../Include/AT24_EA_Core_SelfTest.mqh"

input double InpRiskPercent = 1.0;   // risk % used for the lot-sizing check
input double InpSLPoints    = 500;   // SL distance in points for the checks

void OnStart()
  {
   AT24_RunSelfTest(InpRiskPercent, InpSLPoints);
  }
