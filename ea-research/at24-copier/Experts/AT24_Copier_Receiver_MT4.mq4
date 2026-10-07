//+------------------------------------------------------------------+
//| AT24_Copier_Receiver_MT4.mq4                                     |
//| AT24 Local Trade Copier - RECEIVER (MetaTrader 4).               |
//|                                                                  |
//| Mirrors the positions a Master (MT4 or MT5, same PC) publishes: |
//| open, SL/TP changes, partial close, close. Never uses a network, |
//| a DLL or a server. Every copy is tagged "AT24C:<masterId>" with  |
//| its own magic number; orders you open by hand or with other EAs  |
//| are never touched.                                               |
//|                                                                  |
//| Safety defaults: existing master positions at start are NOT      |
//| copied, a stale/offline master file never triggers any action,   |
//| an empty book must persist a few seconds before copies are       |
//| closed, open attempts per trade are capped, volume is capped.    |
//|                                                                  |
//| MT4 note: a partial close gives the remaining volume a NEW       |
//| ticket (and often a new comment) - the Receiver re-links it.     |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property strict
#property description "AT24 Local Trade Copier - Receiver for MT4 (mirrors a local Master; no server, no DLL)."

#include "..\Include\AT24_Copier_Proto.mqh"
#include "..\Include\AT24_Copier_RxLock.mqh"

//--- Channel
input string ChannelId            = "default";            // Must match the Master's ChannelId
input long   ExpectedMasterLogin  = 0;                    // 0 = accept any master on this channel
input int    StaleSeconds         = 10;                   // Master silent longer than this = offline (nothing is done)

//--- Lot sizing
input ENUM_AT24C_LOT_MODE LotMode = AT24C_LOT_MULTIPLIER; // Multiplier / Fixed lot / Equity ratio
input double LotMultiplier        = 1.0;                  // Multiplier (also scales Equity ratio)
input double FixedLot             = 0.01;                 // Used when LotMode = Fixed lot
input double MaxLotPerTrade       = 10.0;                 // Hard cap per copied trade (0 = no cap)

//--- What to copy
input long   MasterMagicFilter    = -1;                   // -1 = all master positions, else only this master magic
input string AllowedSymbols       = "";                   // Master symbols to copy, comma separated (empty = all)
input bool   ReverseCopy          = false;                // Copy buys as sells and vice versa (SL and TP are swapped)
input bool   CopySLTP             = true;                 // Copy and follow stop loss / take profit
input bool   CopyExistingOnStart  = false;                // false = ignore positions already open when this EA starts
input int    MaxEntryDelaySec     = 20;                   // Do not copy a trade the master opened longer ago than this

//--- Symbols
input string MasterSymbolPrefix   = "";                   // Prefix to strip from master symbols (e.g. "m.")
input string MasterSymbolSuffix   = "";                   // Suffix to strip from master symbols (e.g. ".m")
input string ReceiverSymbolPrefix = "";                   // Prefix to add on this account (e.g. "#")
input string ReceiverSymbolSuffix = "";                   // Suffix to add on this account (e.g. "+")
input string SymbolMap            = "";                   // Explicit map, e.g. XAUUSD=GOLD;US30=DJ30

//--- Execution
input int    ReceiverMagic        = 8240124;              // Magic number of every copied order (change it if another EA already uses this number)
input int    MaxSlippagePoints    = 30;                   // Deviation allowed on entry/exit
input double MaxSpreadPoints      = 0.0;                  // Do not open while spread is wider (0 = off)
input ENUM_AT24C_STOPS_POLICY StopsPolicy = AT24C_STOPS_SKIP; // Master SL/TP closer than my broker allows
input int    EmptySnapshotConfirmSec = 3;                 // Master book must stay empty this long before copies are closed
input int    PollMilliseconds     = 200;
input bool   DryRun               = false;                // Log what would happen, send no orders

//--- state
string     g_file      = "";
string     g_chan      = "";
SCopyHeader g_hdr;
SCopyPos   g_pos[];
int        g_n         = 0;
bool       g_synced    = false;
long       g_login     = 0;
long       g_lastPrune = 0;
long       g_emptySince = 0;
int        g_badReads  = 0;
string     g_status    = "starting";
string     g_masterInfo = "";
int        g_opened = 0, g_closed = 0, g_modified = 0, g_skipped = 0, g_errors = 0;

long       g_legacy[];            // master ids ignored because they were open before we started
long       g_ignored[];           // master ids we decided never to copy (too old, too small, bad symbol...)
long       g_attId[];             // open attempts per master id
int        g_attCount[];
uint       g_attLastMs[];
string     g_logKey[];
uint       g_logMs[];

//+------------------------------------------------------------------+
//| small utilities                                                  |
//+------------------------------------------------------------------+
bool InArr(const long &a[], const long v)
  {
   for(int i = 0; i < ArraySize(a); i++)
      if(a[i] == v)
         return true;
   return false;
  }

void AddArr(long &a[], const long v)
  {
   int n = ArraySize(a);
   ArrayResize(a, n + 1);
   a[n] = v;
  }

bool InSnapshot(const long id)
  {
   for(int i = 0; i < g_n; i++)
      if(g_pos[i].id == id)
         return true;
   return false;
  }

void PruneArr(long &a[])
  {
   long keep[];
   int  nk = 0;
   for(int i = 0; i < ArraySize(a); i++)
      if(InSnapshot(a[i]))
        {
         ArrayResize(keep, nk + 1);
         keep[nk++] = a[i];
        }
   ArrayResize(a, nk);
   for(int i = 0; i < nk; i++)
      a[i] = keep[i];
  }

void LogOnce(const string key, const string msg)
  {
   uint now = GetTickCount();     // MT4 has no 64-bit tick count; unsigned subtraction survives the 49-day wrap
   for(int i = 0; i < ArraySize(g_logKey); i++)
      if(g_logKey[i] == key)
        {
         if((uint)(now - g_logMs[i]) < 30000)
            return;
         g_logMs[i] = now;
         PrintFormat("[AT24-COPIER] %s", msg);
         return;
        }
   int n = ArraySize(g_logKey);
   ArrayResize(g_logKey, n + 1);
   ArrayResize(g_logMs, n + 1);
   g_logKey[n] = key;
   g_logMs[n]  = now;
   PrintFormat("[AT24-COPIER] %s", msg);
  }

int AttIdx(const long id)
  {
   for(int i = 0; i < ArraySize(g_attId); i++)
      if(g_attId[i] == id)
         return i;
   return -1;
  }

bool AttemptAllowed(const long id)
  {
   int i = AttIdx(id);
   if(i < 0)
      return true;
   if(g_attCount[i] >= 3)
      return false;
   return (uint)(GetTickCount() - g_attLastMs[i]) >= 3000;
  }

void AttemptNoted(const long id)
  {
   int i = AttIdx(id);
   if(i < 0)
     {
      i = ArraySize(g_attId);
      ArrayResize(g_attId, i + 1);
      ArrayResize(g_attCount, i + 1);
      ArrayResize(g_attLastMs, i + 1);
      g_attId[i] = id;
      g_attCount[i] = 0;
     }
   g_attCount[i]++;
   g_attLastMs[i] = GetTickCount();
  }

void AttemptsReset(const long id)
  {
   int i = AttIdx(id);
   if(i >= 0)
      g_attCount[i] = 0;
  }

//--- Registry of my copies keyed by MY order ticket -> master id (terminal global variables). Comments
//--- can be rewritten by the broker and a partial close creates a new ticket; the registry keeps every
//--- copy mappable without relying on either.
string GvTicketName(const int ticket)
  {
   return "AT24C_" + g_chan + "_T" + IntegerToString(ticket);
  }

void RegistrySet(const int ticket, const long masterId)
  {
   if(masterId > 0 && masterId < 4503599627370496)
      GlobalVariableSet(GvTicketName(ticket), (double)masterId);
  }

long RegistryGet(const int ticket)
  {
   string n = GvTicketName(ticket);
   return GlobalVariableCheck(n) ? (long)GlobalVariableGet(n) : 0;
  }

void RegistryDel(const int ticket)
  {
   GlobalVariableDel(GvTicketName(ticket));
  }

bool OrderIsOpen(const int ticket)
  {
   return OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES) && OrderCloseTime() == 0;
  }

void RegistryPrune()
  {
   string prefix = "AT24C_" + g_chan + "_T";
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
     {
      string nm = GlobalVariableName(i);
      if(StringFind(nm, prefix) != 0)
         continue;
      int t = (int)StringToInteger(StringSubstr(nm, StringLen(prefix)));
      if(t <= 0 || !OrderIsOpen(t))
         GlobalVariableDel(nm);
     }
  }

double NormPrice(const string sym, const double price)
  {
   if(price <= 0.0)
      return 0.0;
   int    digits = (int)MarketInfo(sym, MODE_DIGITS);
   double ts     = MarketInfo(sym, MODE_TICKSIZE);
   if(ts <= 0.0)
      return NormalizeDouble(price, digits);
   return NormalizeDouble(MathRound(price / ts) * ts, digits);
  }

//--- Stops that the broker would accept for a NEW order; may clamp when the policy says so.
bool PrepareStops(const string sym, const int cmd, double &sl, double &tp, string &why)
  {
   why = "";
   if(sl <= 0.0 && tp <= 0.0)
      return true;
   double point = MarketInfo(sym, MODE_POINT);
   double minD  = MarketInfo(sym, MODE_STOPLEVEL) * point;
   double bid   = MarketInfo(sym, MODE_BID);
   double ask   = MarketInfo(sym, MODE_ASK);
   bool   buy   = (cmd == OP_BUY);
   double ref   = buy ? bid : ask;
   if(ref <= 0.0)
     { why = "no price"; return false; }

   if(sl > 0.0)
     {
      bool wrong = buy ? (sl >= ref) : (sl <= ref);
      bool close = MathAbs(ref - sl) < minD;
      if(wrong || close)
        {
         if(StopsPolicy == AT24C_STOPS_CLAMP && !wrong)
            sl = NormPrice(sym, buy ? ref - minD : ref + minD);
         else
           { why = wrong ? "SL on the wrong side of price" : "SL closer than my broker's stops level"; return false; }
        }
     }
   if(tp > 0.0)
     {
      bool wrong = buy ? (tp <= ref) : (tp >= ref);
      bool close = MathAbs(tp - ref) < minD;
      if(wrong || close)
        {
         if(StopsPolicy == AT24C_STOPS_CLAMP && !wrong)
            tp = NormPrice(sym, buy ? ref + minD : ref - minD);
         else
           { why = wrong ? "TP on the wrong side of price" : "TP closer than my broker's stops level"; return false; }
        }
     }
   return true;
  }

string ErrText(const int e)
  {
   switch(e)
     {
      case 128: return "trade timeout (outcome unknown)";
      case 130: return "invalid stops";
      case 131: return "invalid volume";
      case 132: return "market closed";
      case 133: return "trading disabled for this symbol";
      case 134: return "not enough money";
      case 135: return "price changed";
      case 136: return "off quotes";
      case 138: return "requote";
      case 139: return "order locked";
      case 141: return "too many requests";
      case 145: return "modification denied (too close to market)";
      case 146: return "trade context busy";
      case 147: return "expiration denied";
      case 148: return "too many orders";
      case 149: return "hedging prohibited by this broker/account";
      case 150: return "FIFO rule - closing must follow the oldest order first";
      case 4108: return "invalid ticket";
      case 4109: return "trading not allowed (enable AutoTrading + Allow live trading)";
     }
   return "error " + IntegerToString(e);
  }

bool ErrUnknownOutcome(const int e)
  {
   return e == 128 || e == 142 || e == 143;
  }

//+------------------------------------------------------------------+
//| receiver-side view                                               |
//+------------------------------------------------------------------+
struct SRecv
  {
   int      ticket;
   long     mid;      // master id this copy belongs to (0 = unknown)
   double   volume;
   string   symbol;
   double   sl;
   double   tp;
   int      cmd;
  };

//--- After a partial close MT4 may rename the remaining order ("from #12345"): follow the old ticket's link.
long LinkFromComment(const int ticket, const string comment)
  {
   if(StringFind(comment, "from #") != 0)
      return 0;
   int old = (int)StringToInteger(StringSubstr(comment, 6));
   if(old <= 0)
      return 0;
   long mid = RegistryGet(old);
   if(mid > 0)
      RegistrySet(ticket, mid);
   return mid;
  }

int GatherReceiver(SRecv &r[])
  {
   int total = OrdersTotal();
   int n = 0;
   ArrayResize(r, 0);
   for(int i = 0; i < total; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderType() > OP_SELL || OrderMagicNumber() != ReceiverMagic)
         continue;
      ArrayResize(r, n + 1);
      r[n].ticket = OrderTicket();
      r[n].volume = OrderLots();
      r[n].symbol = OrderSymbol();
      r[n].sl     = OrderStopLoss();
      r[n].tp     = OrderTakeProfit();
      r[n].cmd    = OrderType();
      long mid = 0;
      string cm = OrderComment();
      if(!AT24C_ParseComment(cm, mid))
        {
         mid = RegistryGet(r[n].ticket);
         if(mid <= 0)
            mid = LinkFromComment(r[n].ticket, cm);
        }
      r[n].mid = mid;
      n++;
     }
   return n;
  }

//+------------------------------------------------------------------+
//| trade operations                                                 |
//+------------------------------------------------------------------+
double ClosePrice(const string sym, const int cmd)
  {
   RefreshRates();
   return (cmd == OP_BUY) ? MarketInfo(sym, MODE_BID) : MarketInfo(sym, MODE_ASK);
  }

bool CloseCopy(const int ticket, const long mid, const string why)
  {
   if(DryRun)
     {
      LogOnce("dryclose" + IntegerToString(ticket), StringFormat("[DRY] would close #%d (%s)", ticket, why));
      return true;
     }
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES) || OrderCloseTime() != 0)
      return false;
   double lots = OrderLots();
   ResetLastError();
   if(OrderClose(ticket, lots, ClosePrice(OrderSymbol(), OrderType()), MaxSlippagePoints, clrNONE))
     {
      g_closed++;
      RegistryDel(ticket);
      PrintFormat("[AT24-COPIER] closed #%d (%s)", ticket, why);
      return true;
     }
   int e = GetLastError();
   g_errors++;
   LogOnce("closefail" + IntegerToString(ticket), StringFormat("close #%d failed: %s", ticket, ErrText(e)));
   return false;
  }

//--- Remaining volume of a partially closed order gets a new ticket: find it and link it to the master id.
void AdoptRemainder(const int oldTicket, const long mid, const string sym, const int cmd, const datetime openTime, const double openPrice)
  {
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      if(OrderType() != cmd || OrderMagicNumber() != ReceiverMagic || OrderSymbol() != sym || OrderTicket() == oldTicket)
         continue;
      if(OrderOpenTime() != openTime || MathAbs(OrderOpenPrice() - openPrice) > 1e-9)
         continue;
      RegistrySet(OrderTicket(), mid);
     }
  }

bool ClosePartialCopy(const int ticket, const long mid, const double vol, const string why)
  {
   if(DryRun)
     {
      LogOnce("drypart" + IntegerToString(ticket), StringFormat("[DRY] would partially close #%d by %.2f (%s)", ticket, vol, why));
      return true;
     }
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES) || OrderCloseTime() != 0)
      return false;
   string   sym = OrderSymbol();
   int      cmd = OrderType();
   datetime ot  = OrderOpenTime();
   double   op  = OrderOpenPrice();
   ResetLastError();
   if(OrderClose(ticket, vol, ClosePrice(sym, cmd), MaxSlippagePoints, clrNONE))
     {
      g_closed++;
      AdoptRemainder(ticket, mid, sym, cmd, ot, op);
      RegistryDel(ticket);
      PrintFormat("[AT24-COPIER] partial close #%d by %.2f (%s)", ticket, vol, why);
      return true;
     }
   int e = GetLastError();
   g_errors++;
   LogOnce("partfail" + IntegerToString(ticket), StringFormat("partial close #%d failed: %s", ticket, ErrText(e)));
   return false;
  }

bool OpenCopy(const SCopyPos &p, const string sym, const int cmd, const double vol,
              double sl, double tp, const string why)
  {
   if(MaxSpreadPoints > 0.0 && MarketInfo(sym, MODE_SPREAD) > MaxSpreadPoints)
     { LogOnce("spread" + (string)p.id, StringFormat("spread %.0f > max %.0f on %s - waiting", MarketInfo(sym, MODE_SPREAD), MaxSpreadPoints, sym)); return false; }
   string stopsWhy;
   if(!PrepareStops(sym, cmd, sl, tp, stopsWhy))
     {
      PrintFormat("[AT24-COPIER] master #%I64d on %s NOT copied: %s (policy=SKIP; set StopsPolicy=CLAMP to accept)", p.id, sym, stopsWhy);
      AddArr(g_ignored, p.id);
      g_skipped++;
      return false;
     }
   if(DryRun)
     {
      LogOnce("dryopen" + (string)p.id, StringFormat("[DRY] would %s %.2f %s sl=%.5f tp=%.5f (%s)", (cmd == OP_BUY ? "BUY" : "SELL"), vol, sym, sl, tp, why));
      return true;
     }
   AttemptNoted(p.id);
   RefreshRates();
   double price = (cmd == OP_BUY) ? MarketInfo(sym, MODE_ASK) : MarketInfo(sym, MODE_BID);
   string comment = AT24C_MakeComment(p.id);
   ResetLastError();
   int ticket = OrderSend(sym, cmd, vol, price, MaxSlippagePoints, sl, tp, comment, ReceiverMagic, 0, clrNONE);
   int e = GetLastError();
   bool stopsAfter = false;
   if(ticket < 0 && e == 130 && (sl > 0.0 || tp > 0.0))
     {
      //--- some market-execution servers refuse stops on entry: open plain, then attach SL/TP
      ResetLastError();
      RefreshRates();
      price  = (cmd == OP_BUY) ? MarketInfo(sym, MODE_ASK) : MarketInfo(sym, MODE_BID);
      ticket = OrderSend(sym, cmd, vol, price, MaxSlippagePoints, 0.0, 0.0, comment, ReceiverMagic, 0, clrNONE);
      e = GetLastError();
      stopsAfter = (ticket >= 0);
     }
   if(ticket >= 0)
     {
      g_opened++;
      RegistrySet(ticket, p.id);
      PrintFormat("[AT24-COPIER] copied master #%I64d -> %s %.2f %s (%s) ticket %d", p.id, (cmd == OP_BUY ? "BUY" : "SELL"), vol, sym, why, ticket);
      if(stopsAfter && OrderSelect(ticket, SELECT_BY_TICKET))
        {
         if(!OrderModify(ticket, OrderOpenPrice(), sl, tp, 0, clrNONE))
            LogOnce("stopsafter" + IntegerToString(ticket), StringFormat("copy #%d opened but SL/TP could not be attached: %s - the next sync will retry.", ticket, ErrText(GetLastError())));
        }
      return true;
     }
   g_errors++;
   if(ErrUnknownOutcome(e))
      LogOnce("unk" + (string)p.id, StringFormat("open for master #%I64d: outcome UNKNOWN (%s) - waiting to see whether the order appears before any retry", p.id, ErrText(e)));
   else
      LogOnce("openfail" + (string)p.id, StringFormat("open for master #%I64d failed: %s", p.id, ErrText(e)));
   return false;
  }

//+------------------------------------------------------------------+
//| reconcile one snapshot against my orders                         |
//+------------------------------------------------------------------+
void Reconcile(const long now)
  {
   SRecv r[];
   int rn = GatherReceiver(r);
   int ops = 8;

   //--- 1) copies whose master position is gone
   bool hold = false;
   if(g_n == 0 && rn > 0)
     {
      if(g_emptySince == 0)
         g_emptySince = now;
      if(now - g_emptySince < EmptySnapshotConfirmSec)
         hold = true;
     }
   else
      g_emptySince = 0;

   for(int i = 0; i < rn && ops > 0; i++)
     {
      if(r[i].mid <= 0 || InSnapshot(r[i].mid))
         continue;
      if(hold)
        { g_status = "master book empty - confirming before closing copies"; continue; }
      if(CloseCopy(r[i].ticket, r[i].mid, "master closed"))
         r[i].mid = -1;
      ops--;
     }

   PruneArr(g_legacy);
   PruneArr(g_ignored);

   //--- 2) master positions -> copies
   for(int k = 0; k < g_n && ops > 0; k++)
     {
      SCopyPos p = g_pos[k];
      if(InArr(g_legacy, p.id) || InArr(g_ignored, p.id))
         continue;
      if(MasterMagicFilter >= 0 && p.magic != MasterMagicFilter)
         continue;
      if(!AT24C_SymbolAllowed(p.symbol, MasterSymbolPrefix, MasterSymbolSuffix, AllowedSymbols))
         continue;

      string sym = AT24C_MapSymbol(p.symbol, MasterSymbolPrefix, MasterSymbolSuffix, ReceiverSymbolPrefix, ReceiverSymbolSuffix, SymbolMap);
      if(!SymbolSelect(sym, true))
        {
         LogOnce("nosym" + sym, StringFormat("symbol '%s' (master '%s') does not exist on this account - set SymbolMap/prefix/suffix. Trade #%I64d not copied.", sym, p.symbol, p.id));
         AddArr(g_ignored, p.id);
         g_skipped++;
         continue;
        }

      int cmd;
      double sl = p.sl, tp = p.tp;
      if(ReverseCopy)
        {
         cmd = (p.side == 0) ? OP_SELL : OP_BUY;
         sl = p.tp;
         tp = p.sl;
        }
      else
         cmd = (p.side == 0) ? OP_BUY : OP_SELL;
      if(!CopySLTP)
        { sl = 0.0; tp = 0.0; }
      sl = NormPrice(sym, sl);
      tp = NormPrice(sym, tp);

      double step = MarketInfo(sym, MODE_LOTSTEP);
      double vmin = MarketInfo(sym, MODE_MINLOT);
      double vmax = MarketInfo(sym, MODE_MAXLOT);
      double raw  = AT24C_ScaleVolume((int)LotMode, p.volume, LotMultiplier, FixedLot, g_hdr.equity, AccountEquity());
      if(MaxLotPerTrade > 0.0 && raw > MaxLotPerTrade)
        {
         LogOnce("cap" + (string)p.id, StringFormat("master #%I64d: scaled lot %.2f capped to MaxLotPerTrade %.2f", p.id, raw, MaxLotPerTrade));
         raw = MaxLotPerTrade;
        }
      double expected = AT24C_FloorToStep(raw, step, vmin, vmax);

      //--- my copies of this master position
      double have = 0.0;
      int    cnt  = 0;
      for(int i = 0; i < rn; i++)
         if(r[i].mid == p.id && r[i].symbol == sym)
           { have += r[i].volume; cnt++; }

      if(cnt == 0)
        {
         if(expected <= 0.0)
           {
            PrintFormat("[AT24-COPIER] master #%I64d %s %.2f: scaled volume %.4f is below my minimum lot %.2f - not copied.", p.id, p.symbol, p.volume, raw, vmin);
            AddArr(g_ignored, p.id);
            g_skipped++;
            continue;
           }
         if(now - p.openGmt > MaxEntryDelaySec)
           {
            PrintFormat("[AT24-COPIER] master #%I64d %s opened %I64d s ago (> MaxEntryDelaySec %d) - not copied.", p.id, p.symbol, now - p.openGmt, MaxEntryDelaySec);
            AddArr(g_ignored, p.id);
            g_skipped++;
            continue;
           }
         if(!AttemptAllowed(p.id))
            continue;
         OpenCopy(p, sym, cmd, expected, sl, tp, "new master position");
         ops--;
         continue;
        }

      //--- already copied: follow volume, then SL/TP
      AttemptsReset(p.id);
      double diff = NormalizeDouble(have - expected, 8);
      if(expected <= 0.0)
        {
         for(int i = rn - 1; i >= 0 && ops > 0; i--)
            if(r[i].mid == p.id && r[i].symbol == sym)
              { CloseCopy(r[i].ticket, p.id, "master volume scaled below my minimum lot"); ops--; }
         continue;
        }
      if(diff > step / 2.0)
        {
         double left = diff;
         for(int i = rn - 1; i >= 0 && left > step / 2.0 && ops > 0; i--)
           {
            if(r[i].mid != p.id || r[i].symbol != sym)
               continue;
            double part = MathMin(left, r[i].volume);
            if(part >= r[i].volume - 1e-9)
               CloseCopy(r[i].ticket, p.id, "master reduced position");
            else
               ClosePartialCopy(r[i].ticket, p.id, NormalizeDouble(part, AT24C_StepDigits(step)), "master reduced position");
            left -= part;
            ops--;
           }
         continue;
        }
      if(-diff > step / 2.0 && AttemptAllowed(p.id))
        {
         double add = AT24C_FloorToStep(-diff, step, vmin, vmax);
         if(add > 0.0)
           {
            OpenCopy(p, sym, cmd, add, sl, tp, "master added volume");
            ops--;
           }
         continue;
        }
      if(CopySLTP && !DryRun)
        {
         for(int i = 0; i < rn && ops > 0; i++)
           {
            if(r[i].mid != p.id || r[i].symbol != sym)
               continue;
            double eps = MarketInfo(sym, MODE_POINT) / 2.0;
            if(MathAbs(r[i].sl - sl) < eps && MathAbs(r[i].tp - tp) < eps)
               continue;
            double nsl = sl, ntp = tp;
            string why;
            if(!PrepareStops(sym, cmd, nsl, ntp, why))
              { LogOnce("modskip" + IntegerToString(r[i].ticket), StringFormat("SL/TP update for #%d not applied: %s", r[i].ticket, why)); continue; }
            if(!OrderSelect(r[i].ticket, SELECT_BY_TICKET, MODE_TRADES))
               continue;
            ResetLastError();
            if(OrderModify(r[i].ticket, OrderOpenPrice(), nsl, ntp, 0, clrNONE))
              { g_modified++; PrintFormat("[AT24-COPIER] updated #%d sl=%.5f tp=%.5f", r[i].ticket, nsl, ntp); }
            else
              {
               int e = GetLastError();
               if(e != 1)   // 1 = nothing changed
                 { g_errors++; LogOnce("modfail" + IntegerToString(r[i].ticket), StringFormat("modify #%d failed: %s", r[i].ticket, ErrText(e))); }
              }
            ops--;
           }
        }
     }
  }

//+------------------------------------------------------------------+
void ShowStatus()
  {
   Comment("AT24 Copier RECEIVER (MT4) v" + AT24C_VERSION + (DryRun ? "  [DRY RUN]" : "") + (ReverseCopy ? "  [REVERSE]" : "") + "\n",
           "Channel : ", g_chan, "\n",
           "Master  : ", g_masterInfo, "\n",
           "Status  : ", g_status, "\n",
           "Opened ", g_opened, "  Closed ", g_closed, "  SL/TP ", g_modified, "  Skipped ", g_skipped, "  Errors ", g_errors);
  }

int OnInit()
  {
   if(IsTesting())
     {
      Print("[AT24-COPIER] The copier cannot run in the Strategy Tester - attach it to a live or demo chart.");
      return INIT_FAILED;
     }
   if(ReceiverMagic < 0 || LotMultiplier <= 0.0 || (LotMode == AT24C_LOT_FIXED && FixedLot <= 0.0))
     {
      Print("[AT24-COPIER] Invalid inputs (ReceiverMagic / LotMultiplier / FixedLot).");
      return INIT_PARAMETERS_INCORRECT;
     }
   g_chan = AT24C_SanitizeChannel(ChannelId);
   g_file = AT24C_FileName(ChannelId);
   EventSetMillisecondTimer(MathMax(50, PollMilliseconds));
   ShowStatus();
   PrintFormat("[AT24-COPIER] Receiver (MT4) v%s started - channel '%s' (Common/Files/%s)%s. Existing master positions are %s.",
               AT24C_VERSION, g_chan, g_file, DryRun ? " DRY RUN" : "", CopyExistingOnStart ? "COPIED" : "ignored");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   AT24C_RxLockRelease(g_chan);
   Comment("");
  }

void OnTimer()
  {
   if(!DryRun && !IsTradeAllowed())
     {
      g_status = "trading is disabled (enable the AutoTrading button and 'Allow live trading' in the EA properties)";
      ShowStatus();
      return;
     }
   if(!IsConnected() || AccountNumber() == 0)
     {
      g_status = "no broker connection - waiting";
      ShowStatus();
      return;
     }

   long login = (long)AccountNumber();
   if(login != g_login)
     {
      g_login  = login;
      g_synced = false;                   // new account: forget everything learned about the old one
      ArrayResize(g_legacy, 0);
      ArrayResize(g_ignored, 0);
      ArrayResize(g_attId, 0);
      ArrayResize(g_attCount, 0);
      ArrayResize(g_attLastMs, 0);
      g_emptySince = 0;
     }

   string text, err;
   if(!AT24C_ReadTextFile(g_file, text))
     {
      g_status = "waiting for master file (" + g_file + ")";
      g_masterInfo = "-";
      ShowStatus();
      return;
     }
   if(!AT24C_ParseSnapshot(text, g_hdr, g_pos, g_n, err))
     {
      if(++g_badReads >= 25)
         g_status = "master file unreadable: " + err;
      ShowStatus();
      return;
     }
   g_badReads = 0;

   long now = AT24C_NowGmt();
   if(g_hdr.channel != g_chan)
     { g_status = "channel mismatch in file"; ShowStatus(); return; }
   if(ExpectedMasterLogin > 0 && g_hdr.login != ExpectedMasterLogin)
     { g_status = "file belongs to master login " + IntegerToString(g_hdr.login) + " (expected " + IntegerToString(ExpectedMasterLogin) + ")"; ShowStatus(); return; }
   g_masterInfo = StringFormat("%s login %I64d, %d position(s)", g_hdr.platform, g_hdr.login, g_n);
   if(now - g_hdr.writeGmt > StaleSeconds)
     {
      g_status = StringFormat("MASTER OFFLINE (silent %I64d s) - doing nothing", now - g_hdr.writeGmt);
      ShowStatus();
      return;
     }

   if(!AT24C_RxLockAcquire(g_chan))
     {
      g_status = (g_rxLockCycles == 0 && g_rxLockOther > 0)
                 ? "another Receiver is already active on this channel (chart tag " + IntegerToString(g_rxLockOther) + ") - this one does nothing"
                 : "confirming single-Receiver lock";
      ShowStatus();
      return;
     }

   if(!g_synced)
     {
      if(!CopyExistingOnStart)
        {
         for(int i = 0; i < g_n; i++)
            AddArr(g_legacy, g_pos[i].id);
         if(g_n > 0)
            PrintFormat("[AT24-COPIER] %d master position(s) were already open at start and are ignored (CopyExistingOnStart=false).", g_n);
        }
      g_synced = true;
     }

   g_status = DryRun ? "running (dry run)" : "running";
   if(now - g_lastPrune >= 30)
     { RegistryPrune(); g_lastPrune = now; }
   Reconcile(now);
   ShowStatus();
  }

void OnTick() {}
//+------------------------------------------------------------------+
