//+------------------------------------------------------------------+
//| AT24_Copier_X_Verifier.mq5  (TEST TOOL - not shipped)            |
//| Cross-terminal test, RECEIVER side. Places NO orders: it only    |
//| records the receiver account's copier positions (magic           |
//| ReceiverMagic) whenever they change, plus how many OTHER         |
//| positions exist (to prove they are untouched).                   |
//| Output: Common\Files\AT24COPY_XR.txt  (GetTickCount64 clock)     |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property version   "1.00"

#include "..\Include\AT24_Copier_Proto.mqh"

input long ReceiverMagic = 8240124;
input int  DurationSec   = 200;

string g_out = "";

void Log(const string step, const string info)
  {
   string line = StringFormat("%I64u|%s|%s", GetTickCount64(), step, info);
   Print(line);
   g_out += line + "\n";
   AT24C_WriteTextFile("AT24COPY_XR.txt", g_out);
  }

string State(int &others)
  {
   string s = "";
   others = 0;
   int n = PositionsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != ReceiverMagic) { others++; continue; }
      string sym = PositionGetString(POSITION_SYMBOL);
      int dg = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      s += StringFormat("[%s %s vol=%.2f sl=%.*f tp=%.*f c=%s]", sym,
                        PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "BUY" : "SELL",
                        PositionGetDouble(POSITION_VOLUME), dg, PositionGetDouble(POSITION_SL),
                        dg, PositionGetDouble(POSITION_TP), PositionGetString(POSITION_COMMENT));
     }
   return s;
  }

void OnStart()
  {
   for(int i = 0; i < 120; i++)
     {
      if(TerminalInfoInteger(TERMINAL_CONNECTED) && AccountInfoInteger(ACCOUNT_LOGIN) > 0) break;
      Sleep(1000);
     }
   Log("INFO", "account=" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + " server=" + AccountInfoString(ACCOUNT_SERVER) +
       " demo=" + IntegerToString(AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO) +
       " hedging=" + IntegerToString(AccountInfoInteger(ACCOUNT_MARGIN_MODE) == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING) +
       " algoTrading=" + IntegerToString((int)TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)));
   int others = 0;
   string last = State(others);
   int othersStart = others;
   Log("START", "otherPositions=" + IntegerToString(others) + " copierState=" + last);
   ulong t0 = GetTickCount64();
   while(!IsStopped() && GetTickCount64() - t0 < (ulong)DurationSec * 1000)
     {
      string s = State(others);
      if(s != last) { Log("CHANGE", "copierState=" + (StringLen(s) ? s : "(none)")); last = s; }
      Sleep(50);
     }
   State(others);
   Log("END", StringFormat("otherPositions start=%d end=%d untouched=%d", othersStart, others, othersStart == others));
  }
//+------------------------------------------------------------------+
