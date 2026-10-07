//+------------------------------------------------------------------+
//| AT24_Copier_X_MasterDriver_MT4.mqh  (TEST TOOL - not shipped)    |
//| MT4 master-side driver for the cross-terminal copier tests.      |
//| Runs on a DEMO account, places the same scenario as the MT5      |
//| driver (open BUY with SL/TP, modify, partial close, second       |
//| position, closes) with magic MasterMagic and logs each action    |
//| with GetTickCount() (system uptime clock). With WATCH_RECEIVER   |
//| defined it also records the copier orders of THIS account        |
//| (loopback test: Master and Receiver in the same terminal).       |
//| Output: Common\Files\AT24COPY_XM.txt (+ AT24COPY_XR.txt)         |
//+------------------------------------------------------------------+
#property strict

#include "AT24_Copier_Proto.mqh"

input string Channel       = "xtest";
input string TestSymbol    = "EURUSD";
input int    MasterMagic   = 777;
input int    ReceiverMagic = 8240124;
input double MasterLot     = 0.10;
input int    StepWaitSec   = 7;

string g_xm = "";
string g_xr = "";
string g_lastState = "";
int    g_othersStart = 0;

void XmLog(const string step, const string info)
  {
   string line = StringFormat("%u|%s|%s", GetTickCount(), step, info);
   Print(line);
   g_xm += line + "\n";
   AT24C_WriteTextFile("AT24COPY_XM.txt", g_xm);
  }

#ifdef WATCH_RECEIVER
void XrLog(const string step, const string info)
  {
   string line = StringFormat("%u|%s|%s", GetTickCount(), step, info);
   g_xr += line + "\n";
   AT24C_WriteTextFile("AT24COPY_XR.txt", g_xr);
  }

string RxState(int &others)
  {
   string s = "";
   string tickets = "";
   others = 0;
   int n = OrdersTotal();
   for(int i = 0; i < n; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || OrderType() > OP_SELL)
         continue;
      if(OrderMagicNumber() != ReceiverMagic)
        { if(OrderMagicNumber() != MasterMagic) others++; continue; }
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

void Watch()
  {
   int o;
   string s = RxState(o);
   if(s != g_lastState)
     {
      XrLog("CHANGE", "copierState=" + (StringLen(s) ? s : "(none)"));
      g_lastState = s;
     }
  }
#else
void Watch() {}
#endif

//--- sleep while (optionally) watching the receiver orders every 50 ms
void Pause(const int ms)
  {
   uint t0 = GetTickCount();
   while((uint)(GetTickCount() - t0) < (uint)ms)
     {
      Watch();
      Sleep(50);
     }
  }

//--- first open order of this magic/symbol/type (the remainder of a partially closed order has a NEW ticket)
int FindOrder(const int magic, const int type)
  {
   for(int i = 0; i < OrdersTotal(); i++)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && OrderMagicNumber() == magic && OrderSymbol() == TestSymbol && OrderType() == type)
         return OrderTicket();
   return -1;
  }

int OpenOrder(const int type, const double lots, const double sl, const double tp, const string cm)
  {
   RefreshRates();
   double px = (type == OP_BUY) ? MarketInfo(TestSymbol, MODE_ASK) : MarketInfo(TestSymbol, MODE_BID);
   int t = OrderSend(TestSymbol, type, lots, px, 50, sl, tp, cm, MasterMagic, 0, clrNONE);
   if(t < 0 && GetLastError() == 130 && (sl > 0.0 || tp > 0.0))
     {
      RefreshRates();
      px = (type == OP_BUY) ? MarketInfo(TestSymbol, MODE_ASK) : MarketInfo(TestSymbol, MODE_BID);
      t = OrderSend(TestSymbol, type, lots, px, 50, 0.0, 0.0, cm, MasterMagic, 0, clrNONE);
      if(t >= 0 && OrderSelect(t, SELECT_BY_TICKET))
         OrderModify(t, OrderOpenPrice(), sl, tp, 0, clrNONE);
     }
   return t;
  }

bool CloseOrder(const int ticket, const double lots)
  {
   if(!OrderSelect(ticket, SELECT_BY_TICKET))
      return false;
   RefreshRates();
   double px = (OrderType() == OP_BUY) ? MarketInfo(TestSymbol, MODE_BID) : MarketInfo(TestSymbol, MODE_ASK);
   return OrderClose(ticket, lots, px, 50, clrNONE);
  }

void OnStart()
  {
   for(int i = 0; i < 120; i++)
     {
      SymbolSelect(TestSymbol, true);
      if(IsConnected() && AccountNumber() > 0 && IsTradeAllowed() && MarketInfo(TestSymbol, MODE_ASK) > 0.0)
         break;
      Sleep(1000);
     }
   XmLog("INFO", "account=" + IntegerToString(AccountNumber()) + " server=" + AccountServer() + " symbol=" + TestSymbol + " platform=MT4");
#ifdef WATCH_RECEIVER
   XrLog("INFO", "account=" + IntegerToString(AccountNumber()) + " server=" + AccountServer() + " demo=" + IntegerToString(IsDemo()) +
         " algoTrading=" + IntegerToString(IsTradeAllowed()) + " platform=MT4 (loopback: master and receiver on this account)");
#endif
   if(!IsDemo()) { XmLog("ABORT", "not a demo account"); return; }
   if(!IsTradeAllowed()) { XmLog("ABORT", "trading not allowed (AutoTrading off)"); return; }
   if(FindOrder(MasterMagic, OP_BUY) >= 0 || FindOrder(MasterMagic, OP_SELL) >= 0)
     { XmLog("ABORT", "magic already in use"); return; }

   bool alive = false;
   for(int i = 0; i < 60 && !alive; i++)
     {
      string txt, err; SCopyHeader h; SCopyPos p[]; int n = 0;
      if(AT24C_ReadTextFile(AT24C_FileName(Channel), txt) && AT24C_ParseSnapshot(txt, h, p, n, err) && AT24C_NowGmt() - h.writeGmt <= 3)
         alive = true;
      else
         Pause(1000);
     }
   XmLog(alive ? "MASTER_ALIVE" : "ABORT", "master publishing fresh file");
   if(!alive) return;
#ifdef WATCH_RECEIVER
   int o0;
   g_lastState = RxState(o0);
   XrLog("START", "otherPositions=" + IntegerToString(o0) + " copierState=" + g_lastState);
   g_othersStart = o0;
#endif
   Pause(8000);

   int    dg = (int)MarketInfo(TestSymbol, MODE_DIGITS);
   double pt = MarketInfo(TestSymbol, MODE_POINT);
   RefreshRates();
   double ask = MarketInfo(TestSymbol, MODE_ASK);
   double sl1 = NormalizeDouble(ask - 800 * pt, dg), tp1 = NormalizeDouble(ask + 1200 * pt, dg);

   int t1 = OpenOrder(OP_BUY, MasterLot, sl1, tp1, "xtest-master");
   XmLog("OPEN_BUY", StringFormat("ok=%d vol=%.2f sl=%s tp=%s", t1 >= 0, MasterLot, DoubleToString(sl1, dg), DoubleToString(tp1, dg)));
   if(t1 < 0) return;
   Pause(StepWaitSec * 1000);

   double sl2 = NormalizeDouble(sl1 + 300 * pt, dg), tp2 = NormalizeDouble(tp1 + 400 * pt, dg);
   bool ok = OrderSelect(t1, SELECT_BY_TICKET) && OrderModify(t1, OrderOpenPrice(), sl2, tp2, 0, clrNONE);
   XmLog("MODIFY", StringFormat("ok=%d sl=%s tp=%s", ok, DoubleToString(sl2, dg), DoubleToString(tp2, dg)));
   Pause(StepWaitSec * 1000);

   ok = CloseOrder(t1, 0.04);
   XmLog("PARTIAL_CLOSE", StringFormat("ok=%d closed=0.04 remaining=%.2f", ok, MasterLot - 0.04));
   Pause(StepWaitSec * 1000);
   int tRem = FindOrder(MasterMagic, OP_BUY);          // remainder has a NEW ticket on MT4

   int t2 = OpenOrder(OP_SELL, 0.02, 0.0, 0.0, "xtest-master2");
   XmLog("OPEN_SELL", StringFormat("ok=%d vol=0.02", t2 >= 0));
   Pause(StepWaitSec * 1000);

   ok = (t2 >= 0) && CloseOrder(t2, 0.02);
   XmLog("CLOSE_SELL", StringFormat("ok=%d", ok));
   Pause(StepWaitSec * 1000);

   ok = (tRem >= 0) && CloseOrder(tRem, 0.06);
   XmLog("CLOSE_BUY", StringFormat("ok=%d", ok));
   Pause((StepWaitSec + 5) * 1000);
   XmLog("DONE", "master orders left with magic: " + IntegerToString((FindOrder(MasterMagic, OP_BUY) >= 0) + (FindOrder(MasterMagic, OP_SELL) >= 0)));
#ifdef WATCH_RECEIVER
   int o1;
   RxState(o1);
   XrLog("END", StringFormat("otherPositions start=%d end=%d untouched=%d", g_othersStart, o1, g_othersStart == o1));
#endif
  }
//+------------------------------------------------------------------+
