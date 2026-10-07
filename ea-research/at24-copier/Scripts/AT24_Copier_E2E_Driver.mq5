//+------------------------------------------------------------------+
//| AT24_Copier_E2E_Driver.mq5  (TEST TOOL - not shipped to buyers)  |
//| Drives a real end-to-end check of Master + Receiver on a DEMO    |
//| account: it places its own master trades (magic MasterMagic),    |
//| then verifies that the Receiver mirrors every step: open, SL/TP  |
//| change, partial close, second position, close. Results (with     |
//| measured latency) go to Common\Files\AT24COPY_E2E_MT5.txt.       |
//| Refuses to run on a real-money account.                          |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property version   "1.00"

#include <Trade\Trade.mqh>
#include "..\Include\AT24_Copier_Proto.mqh"
#include "..\Include\AT24_Copier_Mt5Exec.mqh"

input string Channel       = "e2e";      // must match Master/Receiver ChannelId
input string TestSymbol    = "";         // symbol to trade ("" = first fully tradable of EURUSD/GBPUSD/USDJPY/XAUUSD)
input long   MasterMagic   = 777;        // magic of the trades this script places (Master MagicFilter)
input long   ReceiverMagic = 240124;     // magic the Receiver uses for copies
input double MasterLot     = 0.10;       // first master trade
input double Multiplier    = 0.5;        // must equal the Receiver LotMultiplier
input bool   ReverseMode   = false;      // true when the Receiver runs with ReverseCopy=true
input int    WaitSec       = 10;         // per-step timeout

CTrade g_t;
string g_sym = "";
string g_out  = "";
int    g_pass = 0, g_fail = 0;
string g_resultFile = "AT24COPY_E2E_MT5.txt";

void Flush()
  {
   AT24C_WriteTextFile(g_resultFile, g_out);
  }

void Say(const string s)
  {
   Print(s);
   g_out += s + "\n";
   Flush();
  }

void Check(const string name, const bool ok, const string extra = "")
  {
   if(ok) g_pass++; else g_fail++;
   Say((ok ? "PASS  " : "FAIL  ") + name + (StringLen(extra) > 0 ? "  [" + extra + "]" : ""));
  }

struct SRx
  {
   int    count;
   double vol;
   ulong  ticket;
   double sl;
   double tp;
   string comment;
   long   type;
  };

void ReadRecv(SRx &s)
  {
   s.count = 0; s.vol = 0.0; s.ticket = 0; s.sl = 0.0; s.tp = 0.0; s.comment = ""; s.type = -1;
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != ReceiverMagic)
         continue;
      s.count++;
      s.vol += PositionGetDouble(POSITION_VOLUME);
      if(s.ticket == 0)
        {
         s.ticket = t;
         s.sl = PositionGetDouble(POSITION_SL);
         s.tp = PositionGetDouble(POSITION_TP);
         s.comment = PositionGetString(POSITION_COMMENT);
         s.type = PositionGetInteger(POSITION_TYPE);
        }
     }
  }

int CountMagic(const long magic)
  {
   int n = 0;
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong t = PositionGetTicket(i);
      if(t != 0 && PositionGetInteger(POSITION_MAGIC) == magic)
         n++;
     }
   return n;
  }

//--- wait until receiver shows exactly `count` positions and (if vol>=0) that total volume
bool WaitRecv(const int count, const double vol, const int sec, ulong &ms)
  {
   ulong t0 = GetTickCount64();
   while(GetTickCount64() - t0 < (ulong)sec * 1000)
     {
      SRx s;
      ReadRecv(s);
      if(s.count == count && (vol < 0.0 || MathAbs(s.vol - vol) < 1e-9))
        { ms = GetTickCount64() - t0; return true; }
      Sleep(100);
     }
   ms = GetTickCount64() - t0;
   return false;
  }

bool WaitSLTP(const double sl, const double tp, const int sec, ulong &ms)
  {
   double pt = SymbolInfoDouble(g_sym, SYMBOL_POINT);
   ulong t0 = GetTickCount64();
   while(GetTickCount64() - t0 < (ulong)sec * 1000)
     {
      SRx s;
      ReadRecv(s);
      if(s.count >= 1 && MathAbs(s.sl - sl) < pt && MathAbs(s.tp - tp) < pt)
        { ms = GetTickCount64() - t0; return true; }
      Sleep(100);
     }
   ms = GetTickCount64() - t0;
   return false;
  }

void CleanupAll()
  {
   for(int round = 0; round < 3; round++)
     {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
        {
         ulong t = PositionGetTicket(i);
         if(t == 0)
            continue;
         long mg = PositionGetInteger(POSITION_MAGIC);
         if(mg == MasterMagic || mg == ReceiverMagic)
            g_t.PositionClose(t, 50);
        }
      if(CountMagic(MasterMagic) + CountMagic(ReceiverMagic) == 0)
         break;
      Sleep(500);
     }
  }

double Norm(const double p)
  {
   return NormalizeDouble(p, (int)SymbolInfoInteger(g_sym, SYMBOL_DIGITS));
  }

void OnStart()
  {
   g_out = "AT24 Copier END-TO-END test (MT5 -> MT5, loopback on one DEMO account)\n";
   //--- the terminal may still be logging in when the script starts
   for(int i = 0; i < 120; i++)
     {
      if(TerminalInfoInteger(TERMINAL_CONNECTED) && AccountInfoInteger(ACCOUNT_LOGIN) > 0 &&
         AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) && SymbolInfoDouble(g_sym, SYMBOL_ASK) > 0.0)
         break;
      SymbolSelect(g_sym, true);
      Sleep(1000);
     }
   g_out += "account=" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + " server=" + AccountInfoString(ACCOUNT_SERVER) + "\n";
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
     { Say("ABORT: not a DEMO account - this test places real orders."); return; }
   if(AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
     { Say("ABORT: account is not hedging."); return; }
   string cands[4] = {"EURUSD", "GBPUSD", "USDJPY", "XAUUSD"};
   g_sym = TestSymbol;
   if(StringLen(g_sym) == 0)
      for(int c = 0; c < 4 && StringLen(g_sym) == 0; c++)
        {
         SymbolSelect(cands[c], true);
         if(SymbolInfoInteger(cands[c], SYMBOL_TRADE_MODE) == SYMBOL_TRADE_MODE_FULL && SymbolInfoDouble(cands[c], SYMBOL_ASK) > 0.0)
            g_sym = cands[c];
        }
   if(StringLen(g_sym) == 0)
     {
      //--- scan the whole symbol list for something this account may actually trade
      int total = SymbolsTotal(false), full = 0;
      string firstFull = "", modes = "";
      for(int k = 0; k < total; k++)
        {
         string nm = SymbolName(k, false);
         long tm = SymbolInfoInteger(nm, SYMBOL_TRADE_MODE);
         if(k < 12)
            modes += nm + "=" + IntegerToString((int)tm) + " ";
         if(tm == SYMBOL_TRADE_MODE_FULL)
           {
            full++;
            if(StringLen(firstFull) == 0 || (StringFind(nm, "EURUSD") == 0 && StringFind(firstFull, "EURUSD") != 0))
               firstFull = nm;
           }
        }
      Say(StringFormat("symbol scan: total=%d fullTrade=%d first=%s | sample modes: %s", total, full, firstFull, modes));
      g_sym = firstFull;
      if(StringLen(g_sym) > 0)
         SymbolSelect(g_sym, true);
     }
   if(StringLen(g_sym) == 0 || !SymbolSelect(g_sym, true))
     { Say("ABORT: no fully tradable symbol available"); return; }
   for(int w = 0; w < 30 && SymbolInfoDouble(g_sym, SYMBOL_ASK) <= 0.0; w++)
      Sleep(500);
   Say("test symbol: " + g_sym);
   if(CountMagic(MasterMagic) + CountMagic(ReceiverMagic) > 0)
     { Say("ABORT: positions with the test magic numbers already exist - not touching them."); return; }

   Say(StringFormat("flags: terminalTrade=%d mqlTrade=%d acctTrade=%d acctExpert=%d symTradeMode=%d connected=%d",
                    (int)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED), (int)MQLInfoInteger(MQL_TRADE_ALLOWED),
                    (int)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED), (int)AccountInfoInteger(ACCOUNT_TRADE_EXPERT),
                    (int)SymbolInfoInteger(g_sym, SYMBOL_TRADE_MODE), (int)TerminalInfoInteger(TERMINAL_CONNECTED)));
   g_t.SetExpertMagicNumber((ulong)MasterMagic);
   g_t.SetTypeFillingBySymbol(g_sym);
   g_t.SetDeviationInPoints(50);

   //--- 0. Master alive?
   string fname = AT24C_FileName(Channel);
   bool alive = false;
   for(int i = 0; i < 60 && !alive; i++)
     {
      string txt, err;
      SCopyHeader h; SCopyPos p[]; int n = 0;
      if(AT24C_ReadTextFile(fname, txt) && AT24C_ParseSnapshot(txt, h, p, n, err) && AT24C_NowGmt() - h.writeGmt <= 3)
         alive = true;
      else
         Sleep(1000);
     }
   Check("master is publishing a fresh file", alive);
   if(!alive) { Say("ABORT: master EA not running on channel " + Channel); return; }
   Sleep(4000);   // let the receiver finish its first sync

   double step = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(g_sym, SYMBOL_VOLUME_MAX);
   ulong ms = 0;
   long expType = ReverseMode ? POSITION_TYPE_SELL : POSITION_TYPE_BUY;

   //--- 1. open BUY with SL/TP
   double ask = SymbolInfoDouble(g_sym, SYMBOL_ASK);
   double ptv = SymbolInfoDouble(g_sym, SYMBOL_POINT);
   double sl1 = Norm(ask - 800 * ptv), tp1 = Norm(ask + 1200 * ptv);
   bool opened = g_t.PositionOpen(g_sym, ORDER_TYPE_BUY, MasterLot, 0.0, sl1, tp1, "e2e-master");
   ulong masterTicket = g_t.ResultOrder();
   Check("master BUY opened (retcode " + IntegerToString((int)g_t.ResultRetcode()) + ")", opened && g_t.ResultRetcode() == TRADE_RETCODE_DONE);
   if(!opened) { CleanupAll(); return; }
   long masterId = 0;
   if(PositionSelectByTicket(masterTicket))
      masterId = PositionGetInteger(POSITION_IDENTIFIER);
   double exp1 = AT24C_FloorToStep(MasterLot * Multiplier, step, vmin, vmax);
   bool got = WaitRecv(1, exp1, WaitSec, ms);
   SRx s; ReadRecv(s);
   Check("1 copy opened with scaled volume " + DoubleToString(exp1, 2), got, "latency " + IntegerToString((int)ms) + " ms, got vol " + DoubleToString(s.vol, 2));
   Check("copy tagged with master id", s.comment == AT24C_MakeComment(masterId), "comment='" + s.comment + "'");
   Check(ReverseMode ? "copy direction reversed (SELL)" : "copy direction same (BUY)", s.type == expType);
   double pt = SymbolInfoDouble(g_sym, SYMBOL_POINT);
   double wantSl = ReverseMode ? tp1 : sl1, wantTp = ReverseMode ? sl1 : tp1;
   Check("copy carries master SL/TP" + string(ReverseMode ? " (swapped)" : ""), MathAbs(s.sl - wantSl) < pt && MathAbs(s.tp - wantTp) < pt, "sl " + DoubleToString(s.sl, 2) + " tp " + DoubleToString(s.tp, 2));

   //--- 2. modify master SL/TP
   double sl2 = Norm(sl1 + 300 * ptv), tp2 = Norm(tp1 + 400 * ptv);
   bool modOk = g_t.PositionModify(masterTicket, sl2, tp2);
   Check("master SL/TP modified", modOk);
   wantSl = ReverseMode ? tp2 : sl2; wantTp = ReverseMode ? sl2 : tp2;
   got = WaitSLTP(wantSl, wantTp, WaitSec, ms);
   Check("copy follows SL/TP change", got, "latency " + IntegerToString((int)ms) + " ms");

   //--- 3. partial close on master (0.10 -> 0.06)
   uint prc; string prt;
   bool part = AT24C_Mt5PartialClose(masterTicket, 0.04, 50, prc, prt);
   Check("master partially closed 0.04", part, "retcode " + IntegerToString((int)prc) + " " + prt);
   double exp3 = AT24C_FloorToStep((MasterLot - 0.04) * Multiplier, step, vmin, vmax);
   got = WaitRecv(1, exp3, WaitSec, ms);
   ReadRecv(s);
   Check("copy partially closed to " + DoubleToString(exp3, 2), got, "latency " + IntegerToString((int)ms) + " ms, got vol " + DoubleToString(s.vol, 2));
   Say("note: comment of the copy after the partial close = '" + s.comment + "' (broker may rewrite comments; the receiver must not depend on it)");

   //--- 4. second master position (SELL)
   double bid = SymbolInfoDouble(g_sym, SYMBOL_BID);
   bool open2 = g_t.PositionOpen(g_sym, ORDER_TYPE_SELL, 0.02, 0.0, 0.0, 0.0, "e2e-master2");
   ulong masterTicket2 = g_t.ResultOrder();
   Check("master SELL 0.02 opened", open2);
   double exp4 = exp3 + AT24C_FloorToStep(0.02 * Multiplier, step, vmin, vmax);
   got = WaitRecv(2, exp4, WaitSec, ms);
   Check("2 copies, total volume " + DoubleToString(exp4, 2), got, "latency " + IntegerToString((int)ms) + " ms");

   //--- 5. close the SELL on master -> only its copy goes
   bool close2 = g_t.PositionClose(masterTicket2, 50);
   Check("master SELL closed", close2);
   got = WaitRecv(1, exp3, WaitSec, ms);
   Check("only the SELL copy closed", got, "latency " + IntegerToString((int)ms) + " ms");

   //--- 6. close the BUY on master -> empty book -> copy closed (after the empty-book confirm delay)
   bool close1 = g_t.PositionClose(masterTicket, 50);
   Check("master BUY closed", close1);
   got = WaitRecv(0, -1.0, WaitSec + 6, ms);
   Check("last copy closed once master book is empty", got, "latency " + IntegerToString((int)ms) + " ms (includes the EmptySnapshotConfirmSec hold)");

   //--- 7. nothing left behind
   Sleep(1500);
   Check("no test positions left on the account", CountMagic(MasterMagic) + CountMagic(ReceiverMagic) == 0);
   CleanupAll();

   Say(StringFormat("SUMMARY  pass=%d fail=%d", g_pass, g_fail));
  }
//+------------------------------------------------------------------+
