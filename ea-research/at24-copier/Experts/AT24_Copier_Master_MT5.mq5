//+------------------------------------------------------------------+
//| AT24_Copier_Master_MT5.mq5                                       |
//| AT24 Local Trade Copier - MASTER (MetaTrader 5).                 |
//|                                                                  |
//| Reads this account's open positions and publishes them to a file |
//| in the terminal COMMON folder. It NEVER trades, never opens a    |
//| network connection and never calls a DLL. Attach it to any one   |
//| chart of the account whose trades you want to copy.              |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property description "AT24 Local Trade Copier - Master (publishes open positions to a local file; never trades)."

#include "..\Include\AT24_Copier_Proto.mqh"

input string ChannelId        = "default"; // Channel name - Master and Receiver must use the same one
input long   MagicFilter      = -1;        // -1 = publish every position, otherwise only this magic number
input int    HeartbeatSeconds = 1;         // Rewrite the file at least this often (receiver treats silence as offline)
input int    PollMilliseconds = 100;       // How often positions are checked
input int    StartupGraceSec  = 5;         // Wait this long after connecting before the first publish

string   g_file        = "";
long     g_seq         = 0;
string   g_lastSig     = "";
long     g_lastWrite   = 0;
long     g_connectedAt = 0;
int      g_capWarned   = 0;
string   g_status      = "starting";

//+------------------------------------------------------------------+
void ShowStatus()
  {
   Comment("AT24 Copier MASTER v" + AT24C_VERSION + "\n",
           "Channel : ", AT24C_SanitizeChannel(ChannelId), "\n",
           "File    : ", g_file, "\n",
           "Status  : ", g_status, "\n",
           "Writes  : ", (string)g_seq);
  }

//--- Collect this account's open positions (hedging or netting).
int CollectPositions(SCopyPos &pos[])
  {
   int total = PositionsTotal();
   int n = 0;
   long offset = AT24C_NowGmt() - (long)TimeTradeServer();   // server time -> GMT
   ArrayResize(pos, 0);
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      long magic = PositionGetInteger(POSITION_MAGIC);
      if(MagicFilter >= 0 && magic != MagicFilter)
         continue;
      if(n >= AT24C_MAX_POS)
        {
         if(g_capWarned == 0)
            PrintFormat("[AT24-COPIER] WARNING: more than %d positions - extra ones are not published.", AT24C_MAX_POS);
         g_capWarned = 1;
         break;
        }
      ArrayResize(pos, n + 1);
      pos[n].id      = (long)PositionGetInteger(POSITION_IDENTIFIER);
      pos[n].symbol  = PositionGetString(POSITION_SYMBOL);
      pos[n].side    = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 0 : 1;
      pos[n].volume  = PositionGetDouble(POSITION_VOLUME);
      pos[n].price   = PositionGetDouble(POSITION_PRICE_OPEN);
      pos[n].sl      = PositionGetDouble(POSITION_SL);
      pos[n].tp      = PositionGetDouble(POSITION_TP);
      pos[n].openGmt = (long)PositionGetInteger(POSITION_TIME) + offset;
      pos[n].magic   = magic;
      n++;
     }
   return n;
  }

//--- Signature of the position set only (not time/equity) so unchanged books are not rewritten every poll.
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
   h.platform = "MT5";
   h.seq      = g_seq + 1;
   h.writeGmt = now;
   h.login    = (long)AccountInfoInteger(ACCOUNT_LOGIN);
   h.equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   h.balance  = AccountInfoDouble(ACCOUNT_BALANCE);
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
   if(MQLInfoInteger(MQL_TESTER))
     {
      Print("[AT24-COPIER] The copier cannot run in the Strategy Tester - attach it to a live or demo chart.");
      return INIT_FAILED;
     }
   g_file = AT24C_FileName(ChannelId);

   //--- warn if another Master is already publishing on this channel
   string text, err;
   SCopyHeader  oh;
   SCopyPos     op[];
   int          on = 0;
   if(AT24C_ReadTextFile(g_file, text) && AT24C_ParseSnapshot(text, oh, op, on, err))
     {
      long me = (long)AccountInfoInteger(ACCOUNT_LOGIN);
      if(AT24C_NowGmt() - oh.writeGmt < 5 && (oh.login != me || oh.platform != "MT5"))
         PrintFormat("[AT24-COPIER] WARNING: channel '%s' is being written by another Master (login %I64d, %s). Two Masters on one channel will fight - use a different ChannelId.",
                     AT24C_SanitizeChannel(ChannelId), oh.login, oh.platform);
     }

   EventSetMillisecondTimer(MathMax(50, PollMilliseconds));
   ShowStatus();
   PrintFormat("[AT24-COPIER] Master v%s started - channel '%s' -> Common\\Files\\%s (read-only, never trades).",
               AT24C_VERSION, AT24C_SanitizeChannel(ChannelId), g_file);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
   //--- The file is intentionally left as is: it goes stale, and a Receiver never acts on a stale file.
  }

void OnTimer()
  {
   //--- Never publish before the terminal is connected and positions are loaded: an empty
   //--- book published too early would look like "master closed everything".
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) || AccountInfoInteger(ACCOUNT_LOGIN) == 0)
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

void OnTick() {}
//+------------------------------------------------------------------+
