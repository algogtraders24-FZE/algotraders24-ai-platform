//+------------------------------------------------------------------+
//| AT24_Copier_SelfTest.mq5 - protocol self-test (MT5 script)       |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property version   "1.00"
#property script_show_inputs

#include "..\Include\AT24_Copier_SelfTest.mqh"

void OnStart()
  {
   string report;
   int failed = AT24C_RunSelfTest(report);
   Print(report);
   AT24C_WriteTextFile("AT24COPY_SELFTEST_MT5.txt", report);
   Print(failed == 0 ? "AT24 copier self-test: ALL PASSED" : "AT24 copier self-test: FAILURES = " + IntegerToString(failed));
  }
