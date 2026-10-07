//+------------------------------------------------------------------+
//| AT24_Copier_X_Verifier_MT4.mq4  (TEST TOOL - not shipped)        |
//| Cross-terminal test, MT4 RECEIVER side. Places NO orders: it     |
//| only records the account's copier orders (magic ReceiverMagic)   |
//| whenever they change, plus how many OTHER open orders exist (to  |
//| prove they are untouched).                                       |
//| Output: Common\Files\AT24COPY_XR.txt  (GetTickCount clock - the  |
//| same uptime clock as the MT5 side while uptime < 49 days)        |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property version   "1.00"
#property strict

#include "..\Include\AT24_Copier_Proto.mqh"

input int ReceiverMagic = 8240124;
input int DurationSec   = 200;

string g_out = "";

void Log(const string step, const string info)
  {
   string line = StringFormat("%u|%s|%s", GetTickCount(), step, info);
   Print(line);
   g_out += line + "\n";
   AT24C_WriteTextFile("AT24COPY_XR.txt", g_out);
  }

string State(int &others)
  {
   string s = "";
   string tickets = "";
   others = 0;
   int n = OrdersTotal();
   for(int i = 0; i < n; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderType() > OP_SELL)
         continue;
      if(OrderMagicNumber() != ReceiverMagic)
        { others++; continue; }
      string sym = OrderSymbol();
      int dg = (int)MarketInfo(sym, MODE_DIGITS);
      string tk = "#" + IntegerToString(OrderTicket());
      if(StringFind(tickets, tk + ",") >= 0)
         continue;                       // same ticket read twice while the order pool updates
      tickets += tk + ",";
      s += "[" + sym + " " + (OrderType() == OP_BUY ? "BUY" : "SELL") + " " + tk + " vol=" + DoubleToString(OrderLots(), 2) +
           " sl=" + DoubleToString(OrderStopLoss(), dg) + " tp=" + DoubleToString(OrderTakeProfit(), dg) +
           " c=" + OrderComment() + "]";
     }
   return s;
  }

void OnStart()
  {
   for(int i = 0; i < 120; i++)
     {
      if(IsConnected() && AccountNumber() > 0)
         break;
      Sleep(1000);
     }
   Log("INFO", "account=" + IntegerToString(AccountNumber()) + " server=" + AccountServer() +
       " demo=" + IntegerToString(IsDemo()) + " algoTrading=" + IntegerToString(IsTradeAllowed()) + " platform=MT4");
   int others = 0;
   string last = State(others);
   int othersStart = others;
   Log("START", "otherPositions=" + IntegerToString(others) + " copierState=" + last);
   uint t0 = GetTickCount();
   while(!IsStopped() && (uint)(GetTickCount() - t0) < (uint)DurationSec * 1000)
     {
      string s = State(others);
      if(s != last) { Log("CHANGE", "copierState=" + (StringLen(s) ? s : "(none)")); last = s; }
      Sleep(50);
     }
   State(others);
   Log("END", StringFormat("otherPositions start=%d end=%d untouched=%d", othersStart, others, othersStart == others));
  }
//+------------------------------------------------------------------+
