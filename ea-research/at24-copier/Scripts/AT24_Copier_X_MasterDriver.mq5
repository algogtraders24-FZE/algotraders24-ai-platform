//+------------------------------------------------------------------+
//| AT24_Copier_X_MasterDriver.mq5  (TEST TOOL - not shipped)        |
//| Cross-terminal test, MASTER side: runs on the master account     |
//| (DEMO only), places the same scenario as the loopback E2E test   |
//| and logs every action with GetTickCount64() (system uptime clock |
//| - identical for every terminal on this PC). The receiver-side    |
//| AT24_Copier_X_Verifier.mq5 logs what the other account shows.    |
//| Output: Common\Files\AT24COPY_XM.txt                             |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property version   "1.00"

#include <Trade\Trade.mqh>
#include "..\Include\AT24_Copier_Proto.mqh"
#include "..\Include\AT24_Copier_Mt5Exec.mqh"

input string Channel     = "xtest";
input string TestSymbol  = "EURUSD.sd";
input long   MasterMagic = 777;
input double MasterLot   = 0.10;
input int    StepWaitSec = 7;     // pause after every action so the receiver side can settle

CTrade g_t;
string g_out = "";

void Log(const string step, const string info)
  {
   string line = StringFormat("%I64u|%s|%s", GetTickCount64(), step, info);
   Print(line);
   g_out += line + "\n";
   AT24C_WriteTextFile("AT24COPY_XM.txt", g_out);
  }

void Pause() { Sleep(StepWaitSec * 1000); }

void OnStart()
  {
   for(int i = 0; i < 120; i++)
     {
      SymbolSelect(TestSymbol, true);
      if(TerminalInfoInteger(TERMINAL_CONNECTED) && AccountInfoInteger(ACCOUNT_LOGIN) > 0 &&
         AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) && SymbolInfoDouble(TestSymbol, SYMBOL_ASK) > 0.0)
         break;
      Sleep(1000);
     }
   Log("INFO", "account=" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + " server=" + AccountInfoString(ACCOUNT_SERVER) + " symbol=" + TestSymbol);
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO) { Log("ABORT", "not a demo account"); return; }
   if(SymbolInfoInteger(TestSymbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_FULL) { Log("ABORT", "symbol not fully tradable"); return; }
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong t = PositionGetTicket(i);
      if(t != 0 && PositionGetInteger(POSITION_MAGIC) == MasterMagic) { Log("ABORT", "magic already in use"); return; }
     }
   //--- wait for a fresh master file
   bool alive = false;
   for(int i = 0; i < 60 && !alive; i++)
     {
      string txt, err; SCopyHeader h; SCopyPos p[]; int n = 0;
      if(AT24C_ReadTextFile(AT24C_FileName(Channel), txt) && AT24C_ParseSnapshot(txt, h, p, n, err) && AT24C_NowGmt() - h.writeGmt <= 3)
         alive = true;
      else
         Sleep(1000);
     }
   Log(alive ? "MASTER_ALIVE" : "ABORT", "master publishing fresh file");
   if(!alive) return;
   Sleep(8000);   // let the receiver on the other terminal finish its first sync

   g_t.SetExpertMagicNumber((ulong)MasterMagic);
   g_t.SetTypeFillingBySymbol(TestSymbol);
   g_t.SetDeviationInPoints(50);
   double pt = SymbolInfoDouble(TestSymbol, SYMBOL_POINT);
   int dg = (int)SymbolInfoInteger(TestSymbol, SYMBOL_DIGITS);
   double ask = SymbolInfoDouble(TestSymbol, SYMBOL_ASK);
   double sl1 = NormalizeDouble(ask - 800 * pt, dg), tp1 = NormalizeDouble(ask + 1200 * pt, dg);

   bool ok = g_t.PositionOpen(TestSymbol, ORDER_TYPE_BUY, MasterLot, 0.0, sl1, tp1, "xtest-master");
   ulong t1 = g_t.ResultOrder();
   Log("OPEN_BUY", StringFormat("ok=%d vol=%.2f sl=%.*f tp=%.*f", ok, MasterLot, dg, sl1, dg, tp1));
   if(!ok) return;
   Pause();

   double sl2 = NormalizeDouble(sl1 + 300 * pt, dg), tp2 = NormalizeDouble(tp1 + 400 * pt, dg);
   ok = g_t.PositionModify(t1, sl2, tp2);
   Log("MODIFY", StringFormat("ok=%d sl=%.*f tp=%.*f", ok, dg, sl2, dg, tp2));
   Pause();

   uint rc; string rt;
   ok = AT24C_Mt5PartialClose(t1, 0.04, 50, rc, rt);
   Log("PARTIAL_CLOSE", StringFormat("ok=%d closed=0.04 remaining=%.2f", ok, MasterLot - 0.04));
   Pause();

   ok = g_t.PositionOpen(TestSymbol, ORDER_TYPE_SELL, 0.02, 0.0, 0.0, 0.0, "xtest-master2");
   ulong t2 = g_t.ResultOrder();
   Log("OPEN_SELL", StringFormat("ok=%d vol=0.02", ok));
   Pause();

   ok = g_t.PositionClose(t2, 50);
   Log("CLOSE_SELL", StringFormat("ok=%d", ok));
   Pause();

   ok = g_t.PositionClose(t1, 50);
   Log("CLOSE_BUY", StringFormat("ok=%d", ok));
   Sleep((StepWaitSec + 5) * 1000);
   Log("DONE", "master positions left with magic: " + IntegerToString(PositionsTotal()));
  }
//+------------------------------------------------------------------+
