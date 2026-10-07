//+------------------------------------------------------------------+
//| AT24_Copier_Master_MT4.mq4                                       |
//| AT24 Local Trade Copier - MASTER (MetaTrader 4).                 |
//|                                                                  |
//| Reads this account's open market orders (buy/sell) and publishes |
//| them to a file in the terminal COMMON folder. It NEVER trades,   |
//| never opens a network connection and never calls a DLL. Attach   |
//| it to any one chart of the account whose trades you want to copy.|
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property strict
#property description "AT24 Local Trade Copier - Master (publishes open positions to a local file; never trades)."

#include "..\Include\AT24_Copier_Proto.mqh"

input string ChannelId        = "default"; // Channel name - Master and Receiver must use the same one
input long   MagicFilter      = -1;        // -1 = publish every order, otherwise only this magic number
input int    HeartbeatSeconds = 1;         // Rewrite the file at least this often (receiver treats silence as offline)
input int    PollMilliseconds = 100;       // How often orders are checked
input int    StartupGraceSec  = 5;         // Wait this long after connecting before the first publish

string   g_file        = "";
long     g_seq         = 0;
string   g_lastSig     = "";
long     g_lastWrite   = 0;
long     g_connectedAt = 0;
int      g_capWarned   = 0;
string   g_status      = "starting";
bool     g_offsetKnown = false;

//--- MT4 gives the REMAINING volume of a partially closed order a NEW ticket. The published id must stay
//--- the same for the whole life of a position, otherwise the Receiver would think the position was closed.
int      g_kT[];         // known live tickets
long     g_kId[];        // published id of each
datetime g_kOT[];        // open time / price / symbol / type, to recognise the remainder after a partial close
double   g_kOP[];
string   g_kSym[];
int      g_kTy[];
long     g_offset      = 0;           // server time -> GMT, seconds, learned on live ticks

//+------------------------------------------------------------------+
void ShowStatus()
  {
   Comment("AT24 Copier MASTER (MT4) v" + AT24C_VERSION + "\n",
           "Channel : ", AT24C_SanitizeChannel(ChannelId), "\n",
           "File    : ", g_file, "\n",
           "Status  : ", g_status, "\n",
           "Writes  : ", (string)g_seq);
  }

string GvIdName(const int ticket)
  {
   return "AT24M_" + AT24C_SanitizeChannel(ChannelId) + "_T" + IntegerToString(ticket);
  }

int KnownIdx(const int ticket)
  {
   for(int i = 0; i < ArraySize(g_kT); i++)
      if(g_kT[i] == ticket)
         return i;
   return -1;
  }

bool TicketIsCurrent(const int &cur[], const int ticket)
  {
   for(int i = 0; i < ArraySize(cur); i++)
      if(cur[i] == ticket)
         return true;
   return false;
  }

//--- Published id for the currently selected order (OrderSelect must have been called).
long ResolveId(const int &cur[])
  {
   int    t  = OrderTicket();
   int    k  = KnownIdx(t);
   if(k >= 0)
      return g_kId[k];
   long   id = (long)t;
   string gv = GvIdName(t);
   string cm = OrderComment();
   if(GlobalVariableCheck(gv))
      id = (long)GlobalVariableGet(gv);                        // remembered across a terminal restart
   else
     {
      int from = 0;
      if(StringFind(cm, "from #") == 0)
         from = (int)StringToInteger(StringSubstr(cm, 6));
      int src = (from > 0) ? KnownIdx(from) : -1;
      if(src < 0)
         for(int i = 0; i < ArraySize(g_kT) && src < 0; i++)  // broker kept/blanked the comment: match the vanished order
            if(!TicketIsCurrent(cur, g_kT[i]) && g_kOT[i] == OrderOpenTime() &&
               MathAbs(g_kOP[i] - OrderOpenPrice()) < 1e-9 && g_kSym[i] == OrderSymbol() && g_kTy[i] == OrderType())
               src = i;
      if(src >= 0)
         id = g_kId[src];
      if(id != (long)t && id < 4503599627370496)
         GlobalVariableSet(gv, (double)id);
     }
   int n = ArraySize(g_kT);
   ArrayResize(g_kT, n + 1);  ArrayResize(g_kId, n + 1);  ArrayResize(g_kOT, n + 1);
   ArrayResize(g_kOP, n + 1); ArrayResize(g_kSym, n + 1); ArrayResize(g_kTy, n + 1);
   g_kT[n] = t; g_kId[n] = id; g_kOT[n] = OrderOpenTime(); g_kOP[n] = OrderOpenPrice();
   g_kSym[n] = OrderSymbol(); g_kTy[n] = OrderType();
   return id;
  }

//--- forget tickets that no longer exist (after the remainder of a partial close has inherited their id)
void PruneKnown(const int &cur[])
  {
   for(int i = ArraySize(g_kT) - 1; i >= 0; i--)
     {
      if(TicketIsCurrent(cur, g_kT[i]))
         continue;
      GlobalVariableDel(GvIdName(g_kT[i]));
      int last = ArraySize(g_kT) - 1;
      g_kT[i] = g_kT[last]; g_kId[i] = g_kId[last]; g_kOT[i] = g_kOT[last];
      g_kOP[i] = g_kOP[last]; g_kSym[i] = g_kSym[last]; g_kTy[i] = g_kTy[last];
      ArrayResize(g_kT, last);  ArrayResize(g_kId, last);  ArrayResize(g_kOT, last);
      ArrayResize(g_kOP, last); ArrayResize(g_kSym, last); ArrayResize(g_kTy, last);
     }
  }

//--- Collect this account's open market orders (pending orders are not copied).
int CollectPositions(SCopyPos &pos[])
  {
   int total = OrdersTotal();
   int n = 0;
   long now = AT24C_NowGmt();
   ArrayResize(pos, 0);
   int cur[];                                   // every current market-order ticket (for id inheritance)
   for(int i = 0; i < total; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderType() > OP_SELL)
         continue;
      int c = ArraySize(cur);
      ArrayResize(cur, c + 1);
      cur[c] = OrderTicket();
     }
   for(int i = 0; i < total; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL)
         continue;
      long magic = OrderMagicNumber();
      if(MagicFilter >= 0 && magic != MagicFilter)
         continue;
      if(n >= AT24C_MAX_POS)
        {
         if(g_capWarned == 0)
            PrintFormat("[AT24-COPIER] WARNING: more than %d orders - extra ones are not published.", AT24C_MAX_POS);
         g_capWarned = 1;
         break;
        }
      ArrayResize(pos, n + 1);
      pos[n].id      = ResolveId(cur);
      pos[n].symbol  = OrderSymbol();
      pos[n].side    = (type == OP_BUY) ? 0 : 1;
      pos[n].volume  = OrderLots();
      pos[n].price   = OrderOpenPrice();
      pos[n].sl      = OrderStopLoss();
      pos[n].tp      = OrderTakeProfit();
      long og = g_offsetKnown ? (long)OrderOpenTime() + g_offset : now;   // unknown offset: "just now"
      pos[n].openGmt = (og > now) ? now : og;
      pos[n].magic   = magic;
      n++;
     }
   PruneKnown(cur);
   return n;
  }

string Signature(const SCopyPos &pos[], const int n)
  {
   string s = "";
   for(int i = 0; i < n; i++)
      s += StringFormat("%I64d|%s|%d|%.8f|%.8f|%.8f|%.8f;", pos[i].id, pos[i].symbol, pos[i].side,
                        pos[i].volume, pos[i].price, pos[i].sl, pos[i].tp);
   return s;
  }

void Publish()
  {
   SCopyPos pos[];
   int n = CollectPositions(pos);
   string sig = Signature(pos, n);
   long now = AT24C_NowGmt();
   bool changed   = (sig != g_lastSig);
   bool heartbeat = (now - g_lastWrite >= HeartbeatSeconds);
   if(!changed && !heartbeat)
      return;

   SCopyHeader h;
   h.channel  = ChannelId;
   h.platform = "MT4";
   h.seq      = g_seq + 1;
   h.writeGmt = now;
   h.login    = (long)AccountNumber();
   h.equity   = AccountEquity();
   h.balance  = AccountBalance();
   h.count    = n;

   if(AT24C_WriteTextFile(g_file, AT24C_BuildSnapshot(h, pos, n)))
     {
      g_seq       = h.seq;
      g_lastSig   = sig;
      g_lastWrite = now;
      g_status    = StringFormat("publishing %d position(s)", n);
     }
   else
      g_status = "ERROR: cannot write " + g_file + " (err " + IntegerToString(GetLastError()) + ")";
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(IsTesting())
     {
      Print("[AT24-COPIER] The copier cannot run in the Strategy Tester - attach it to a live or demo chart.");
      return INIT_FAILED;
     }
   g_file = AT24C_FileName(ChannelId);

   string text, err;
   SCopyHeader  oh;
   SCopyPos     op[];
   int          on = 0;
   if(AT24C_ReadTextFile(g_file, text) && AT24C_ParseSnapshot(text, oh, op, on, err))
     {
      long me = (long)AccountNumber();
      if(AT24C_NowGmt() - oh.writeGmt < 5 && (oh.login != me || oh.platform != "MT4"))
         PrintFormat("[AT24-COPIER] WARNING: channel '%s' is being written by another Master (login %I64d, %s). Two Masters on one channel will fight - use a different ChannelId.",
                     AT24C_SanitizeChannel(ChannelId), oh.login, oh.platform);
     }

   EventSetMillisecondTimer(MathMax(50, PollMilliseconds));
   ShowStatus();
   PrintFormat("[AT24-COPIER] Master (MT4) v%s started - channel '%s' -> Common/Files/%s (read-only, never trades).",
               AT24C_VERSION, AT24C_SanitizeChannel(ChannelId), g_file);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTimer()
  {
   //--- Never publish before the terminal is connected and orders are loaded: an empty
   //--- book published too early would look like "master closed everything".
   if(!IsConnected() || AccountNumber() == 0)
     {
      g_connectedAt = 0;
      g_status = "waiting for broker connection";
      ShowStatus();
      return;
     }
   if(g_connectedAt == 0)
      g_connectedAt = AT24C_NowGmt();
   if(AT24C_NowGmt() - g_connectedAt < StartupGraceSec)
     {
      g_status = "connected - startup grace";
      ShowStatus();
      return;
     }
   Publish();
   ShowStatus();
  }

//--- A live tick tells us the server clock exactly -> learn the server->GMT offset (snapped to 15 min).
void OnTick()
  {
   long diff = AT24C_NowGmt() - (long)TimeCurrent();
   g_offset = (long)MathRound((double)diff / 900.0) * 900;
   g_offsetKnown = true;
  }
//+------------------------------------------------------------------+
