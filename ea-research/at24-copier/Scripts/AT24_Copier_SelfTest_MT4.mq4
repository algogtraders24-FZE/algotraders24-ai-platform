//+------------------------------------------------------------------+
//| AT24_Copier_SelfTest_MT4.mq4 - protocol self-test (MT4 script)   |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property version   "1.00"
#property strict

#include "..\Include\AT24_Copier_SelfTest.mqh"

void OnStart()
  {
   string report;
   int failed = AT24C_RunSelfTest(report);
   Print(report);
   AT24C_WriteTextFile("AT24COPY_SELFTEST_MT4.txt", report);
   Print(failed == 0 ? "AT24 copier self-test: ALL PASSED" : "AT24 copier self-test: FAILURES = " + IntegerToString(failed));
  }
