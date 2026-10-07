//+------------------------------------------------------------------+
//| AT24_Copier_Receiver_MT5.mq5                                     |
//| AT24 Local Trade Copier - RECEIVER (MetaTrader 5, hedging acct). |
//|                                                                  |
//| Mirrors the positions a Master (MT4 or MT5, same PC) publishes: |
//| open, SL/TP changes, partial close, close. Never uses a network, |
//| a DLL or a server. Every copy is tagged "AT24C:<masterId>" with  |
//| its own magic number; positions you open by hand or with other   |
//| EAs are never touched.                                           |
//|                                                                  |
//| Safety defaults: existing master positions at start are NOT      |
//| copied, a stale/offline master file never triggers any action,   |
//| an empty book must persist a few seconds before copies are       |
//| closed, open attempts per trade are capped, volume is capped.    |
//+------------------------------------------------------------------+
#property copyright "AT24 - Algotraders24"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property description "AT24 Local Trade Copier - Receiver (mirrors a local Master; no server, no DLL)."

#include <Trade\Trade.mqh>
#include "..\Include\AT24_Copier_Proto.mqh"
#include "..\Include\AT24_Copier_Mt5Exec.mqh"

input group "=== Channel ==="
input string ChannelId            = "default";            // Must match the Master's ChannelId
input long   ExpectedMasterLogin  = 0;                    // 0 = accept any master on this channel
input int    StaleSeconds         = 10;                   // Master silent longer than this = offline (nothing is done)

input group "=== Lot sizing ==="
input ENUM_AT24C_LOT_MODE LotMode = AT24C_LOT_MULTIPLIER; // Multiplier / Fixed lot / Equity ratio
input double LotMultiplier        = 1.0;                  // Multiplier (also scales Equity ratio)
input double FixedLot             = 0.01;                 // Used when LotMode = Fixed lot
input double MaxLotPerTrade       = 10.0;                 // Hard cap per copied trade (0 = no cap)

input group "=== What to copy ==="
input long   MasterMagicFilter    = -1;                   // -1 = all master positions, else only this master magic
input string AllowedSymbols       = "";                   // Master symbols to copy, comma separated (empty = all)
input bool   ReverseCopy          = false;                // Copy buys as sells and vice versa (SL and TP are swapped)
input bool   CopySLTP             = true;                 // Copy and follow stop loss / take profit
input bool   CopyExistingOnStart  = false;                // false = ignore positions already open when this EA starts
input int    MaxEntryDelaySec     = 20;                   // Do not copy a trade the master opened longer ago than this

input group "=== Symbols ==="
input string MasterSymbolPrefix   = "";                   // Prefix to strip from master symbols (e.g. "m.")
input string MasterSymbolSuffix   = "";                   // Suffix to strip from master symbols (e.g. ".m")
input string ReceiverSymbolPrefix = "";                   // Prefix to add on this account (e.g. "#")
input string ReceiverSymbolSuffix = "";                   // Suffix to add on this account (e.g. "+")
input string SymbolMap            = "";                   // Explicit map, e.g. XAUUSD=GOLD;US30=DJ30

input group "=== Execution ==="
input long   ReceiverMagic        = 8240124;              // Magic number of every copied position (change it if another EA already uses this number)
input int    MaxSlippagePoints    = 30;                   // Deviation allowed on entry/exit
input double MaxSpreadPoints      = 0.0;                  // Do not open while spread is wider (0 = off)
input ENUM_AT24C_STOPS_POLICY StopsPolicy = AT24C_STOPS_SKIP; // Master SL/TP closer than my broker allows
input int    EmptySnapshotConfirmSec = 3;                 // Master book must stay empty this long before copies are closed
input int    PollMilliseconds     = 200;
input bool   DryRun               = false;                // Log what would happen, send no orders

//--- state
CTrade     g_trade;
string     g_file      = "";
string     g_chan      = "";
SCopyHeader g_hdr;
SCopyPos   g_pos[];
int        g_n         = 0;
bool       g_synced    = false;
bool       g_modeOk    = false;   // account verified hedging (checked after connect)
long       g_login     = 0;       // account the current state belongs to
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
ulong      g_attLastMs[];
string     g_logKey[];
ulong      g_logMs[];

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

bool InSnapshot(const long id);

//--- keep only ids that are still present in the master snapshot
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
   ulong now = GetTickCount64();
   for(int i = 0; i < ArraySize(g_logKey); i++)
      if(g_logKey[i] == key)
        {
         if(now - g_logMs[i] < 30000)
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

//--- true when another open attempt for this master id is allowed right now
bool AttemptAllowed(const long id)
  {
   int i = AttIdx(id);
   if(i < 0)
      return true;
   if(g_attCount[i] >= 3)
      return false;
   return GetTickCount64() - g_attLastMs[i] >= 3000;   // never hammer; also lets an unconfirmed order show up
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
   g_attLastMs[i] = GetTickCount64();
  }

void AttemptsReset(const long id)
  {
   int i = AttIdx(id);
   if(i >= 0)
      g_attCount[i] = 0;
  }

bool InSnapshot(const long id)
  {
   for(int i = 0; i < g_n; i++)
      if(g_pos[i].id == id)
         return true;
   return false;
  }

//--- Registry of my copies keyed by MY position ticket -> master id. A broker may rewrite the comment of a
//--- position (e.g. after a partial close); the registry keeps every copy mappable without relying on it
//--- and without needing the master to still list the position.
string GvTicketName(const ulong ticket)
  {
   return "AT24C_" + g_chan + "_T" + IntegerToString((long)ticket);
  }

void RegistrySet(const ulong ticket, const long masterId)
  {
   if(masterId > 0 && masterId < 4503599627370496)        // must be exactly representable in a double
      GlobalVariableSet(GvTicketName(ticket), (double)masterId);
  }

long RegistryGet(const ulong ticket)
  {
   string n = GvTicketName(ticket);
   return GlobalVariableCheck(n) ? (long)GlobalVariableGet(n) : 0;
  }

void RegistryDel(const ulong ticket)
  {
   GlobalVariableDel(GvTicketName(ticket));
  }

//--- drop registry entries whose position no longer exists (closed by SL/TP, by hand, ...)
void RegistryPrune()
  {
   string prefix = "AT24C_" + g_chan + "_T";
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
     {
      string nm = GlobalVariableName(i);
      if(StringFind(nm, prefix) != 0)
         continue;
      ulong t = (ulong)StringToInteger(StringSubstr(nm, StringLen(prefix)));
      if(t == 0 || !PositionSelectByTicket(t))
         GlobalVariableDel(nm);
     }
  }

double NormPrice(const string sym, const double price)
  {
   if(price <= 0.0)
      return 0.0;
   int    digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double ts     = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0.0)
      return NormalizeDouble(price, digits);
   return NormalizeDouble(MathRound(price / ts) * ts, digits);
  }

//--- Stops that the broker would accept for a NEW position; may clamp when the policy says so.
bool PrepareStops(const string sym, const ENUM_ORDER_TYPE type, double &sl, double &tp, string &why)
  {
   why = "";
   if(sl <= 0.0 && tp <= 0.0)
      return true;
   double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   double minD  = (double)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * point;
   double bid   = SymbolInfoDouble(sym, SYMBOL_BID);
   double ask   = SymbolInfoDouble(sym, SYMBOL_ASK);
   bool   buy   = (type == ORDER_TYPE_BUY);
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

bool RetcodeOK(const uint rc)
  {
   return rc == TRADE_RETCODE_DONE || rc == TRADE_RETCODE_DONE_PARTIAL || rc == TRADE_RETCODE_PLACED;
  }

bool RetcodeUnknown(const uint rc)
  {
   return rc == TRADE_RETCODE_TIMEOUT || rc == TRADE_RETCODE_CONNECTION || rc == TRADE_RETCODE_ERROR;
  }

//+------------------------------------------------------------------+
//| receiver-side view                                               |
//+------------------------------------------------------------------+
struct SRecv
  {
   ulong  ticket;
   long   mid;      // master id this copy belongs to (0 = unknown)
   double volume;
   string symbol;
   double sl;
   double tp;
  };

int GatherReceiver(SRecv &r[])
  {
   int total = PositionsTotal();
   int n = 0;
   ArrayResize(r, 0);
   for(int i = 0; i < total; i++)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0)
         continue;
      if(PositionGetInteger(POSITION_MAGIC) != ReceiverMagic)
         continue;
      ArrayResize(r, n + 1);
      r[n].ticket = t;
      r[n].volume = PositionGetDouble(POSITION_VOLUME);
      r[n].symbol = PositionGetString(POSITION_SYMBOL);
      r[n].sl     = PositionGetDouble(POSITION_SL);
      r[n].tp     = PositionGetDouble(POSITION_TP);
      long mid = 0;
      if(!AT24C_ParseComment(PositionGetString(POSITION_COMMENT), mid))
         mid = RegistryGet(t);              // broker rewrote the comment: use what we recorded at open time
      r[n].mid = mid;
      n++;
     }
   return n;
  }

//+------------------------------------------------------------------+
//| trade operations                                                 |
//+------------------------------------------------------------------+
bool CloseCopy(const ulong ticket, const long mid, const string why)
  {
   if(DryRun)
     {
      LogOnce("dryclose" + (string)ticket, StringFormat("[DRY] would close #%I64u (%s)", ticket, why));
      return true;
     }
   g_trade.SetDeviationInPoints(MaxSlippagePoints);
   if(g_trade.PositionClose(ticket, MaxSlippagePoints) && RetcodeOK(g_trade.ResultRetcode()))
     {
      g_closed++;
      RegistryDel(ticket);
      PrintFormat("[AT24-COPIER] closed #%I64u (%s)", ticket, why);
      return true;
     }
   g_errors++;
   LogOnce("closefail" + (string)ticket, StringFormat("close #%I64u failed: retcode %u %s", ticket, g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription()));
   return false;
  }

bool ClosePartialCopy(const ulong ticket, const double vol, const string why)
  {
   if(DryRun)
     {
      LogOnce("drypart" + (string)ticket, StringFormat("[DRY] would partially close #%I64u by %.2f (%s)", ticket, vol, why));
      return true;
     }
   uint rc;
   string rcText;
   if(AT24C_Mt5PartialClose(ticket, vol, MaxSlippagePoints, rc, rcText))
     {
      g_closed++;
      PrintFormat("[AT24-COPIER] partial close #%I64u by %.2f (%s)", ticket, vol, why);
      return true;
     }
   g_errors++;
   LogOnce("partfail" + (string)ticket, StringFormat("partial close #%I64u failed: retcode %u %s", ticket, rc, rcText));
   return false;
  }

bool OpenCopy(const SCopyPos &p, const string sym, const ENUM_ORDER_TYPE type, const double vol,
              double sl, double tp, const string why)
  {
   if(MaxSpreadPoints > 0.0)
     {
      double point = SymbolInfoDouble(sym, SYMBOL_POINT);
      double spread = (point > 0.0) ? (SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID)) / point : 0.0;
      if(spread > MaxSpreadPoints)
        { LogOnce("spread" + (string)p.id, StringFormat("spread %.0f > max %.0f on %s - waiting", spread, MaxSpreadPoints, sym)); return false; }
     }
   string stopsWhy;
   if(!PrepareStops(sym, type, sl, tp, stopsWhy))
     {
      PrintFormat("[AT24-COPIER] master #%I64d on %s NOT copied: %s (policy=SKIP; set StopsPolicy=CLAMP to accept)", p.id, sym, stopsWhy);
      AddArr(g_ignored, p.id);
      g_skipped++;
      return false;
     }
   if(DryRun)
     {
      LogOnce("dryopen" + (string)p.id, StringFormat("[DRY] would %s %.2f %s sl=%.5f tp=%.5f (%s)", (type == ORDER_TYPE_BUY ? "BUY" : "SELL"), vol, sym, sl, tp, why));
      return true;
     }
   AttemptNoted(p.id);
   g_trade.SetTypeFillingBySymbol(sym);
   g_trade.SetDeviationInPoints(MaxSlippagePoints);
   bool ok = g_trade.PositionOpen(sym, type, vol, 0.0, sl, tp, AT24C_MakeComment(p.id));
   uint rc = g_trade.ResultRetcode();
   if(ok && RetcodeOK(rc))
     {
      g_opened++;
      ulong ord = g_trade.ResultOrder();
      RegistrySet(ord, p.id);
      PrintFormat("[AT24-COPIER] copied master #%I64d -> %s %.2f %s (%s) ticket %I64u", p.id, (type == ORDER_TYPE_BUY ? "BUY" : "SELL"), vol, sym, why, ord);
      return true;
     }
   g_errors++;
   if(RetcodeUnknown(rc))
      LogOnce("unk" + (string)p.id, StringFormat("open for master #%I64d: outcome UNKNOWN (retcode %u) - waiting to see whether the position appears before any retry", p.id, rc));
   else
      LogOnce("openfail" + (string)p.id, StringFormat("open for master #%I64d failed: retcode %u %s", p.id, rc, g_trade.ResultRetcodeDescription()));
   return false;
  }

//+------------------------------------------------------------------+
//| reconcile one snapshot against my positions                      |
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
         r[i].mid = -1;                      // handled this pass
      ops--;
     }

   //--- forget bookkeeping for master positions that no longer exist
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
         LogOnce("nosym" + sym, StringFormat("symbol '%s' (master '%s') does not exist on this account - set SymbolMap/suffixes. Trade #%I64d not copied.", sym, p.symbol, p.id));
         AddArr(g_ignored, p.id);
         g_skipped++;
         continue;
        }

      ENUM_ORDER_TYPE type;
      double sl = p.sl, tp = p.tp;
      if(ReverseCopy)
        {
         type = (p.side == 0) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
         sl = p.tp;
         tp = p.sl;
        }
      else
         type = (p.side == 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      if(!CopySLTP)
        { sl = 0.0; tp = 0.0; }
      sl = NormPrice(sym, sl);
      tp = NormPrice(sym, tp);

      double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
      double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
      double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
      double raw  = AT24C_ScaleVolume((int)LotMode, p.volume, LotMultiplier, FixedLot, g_hdr.equity, AccountInfoDouble(ACCOUNT_EQUITY));
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
         OpenCopy(p, sym, type, expected, sl, tp, "new master position");
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
               ClosePartialCopy(r[i].ticket, NormalizeDouble(part, AT24C_StepDigits(step)), "master reduced position");
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
            OpenCopy(p, sym, type, add, sl, tp, "master added volume");
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
            double eps = SymbolInfoDouble(sym, SYMBOL_POINT) / 2.0;
            if(MathAbs(r[i].sl - sl) < eps && MathAbs(r[i].tp - tp) < eps)
               continue;
            double nsl = sl, ntp = tp;
            string why;
            if(!PrepareStops(sym, type, nsl, ntp, why))
              { LogOnce("modskip" + (string)r[i].ticket, StringFormat("SL/TP update for #%I64u not applied: %s", r[i].ticket, why)); continue; }
            if(g_trade.PositionModify(r[i].ticket, nsl, ntp) && RetcodeOK(g_trade.ResultRetcode()))
              { g_modified++; PrintFormat("[AT24-COPIER] updated #%I64u sl=%.5f tp=%.5f", r[i].ticket, nsl, ntp); }
            else
              { g_errors++; LogOnce("modfail" + (string)r[i].ticket, StringFormat("modify #%I64u failed: retcode %u %s", r[i].ticket, g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription())); }
            ops--;
           }
        }
     }
  }

//+------------------------------------------------------------------+
void ShowStatus()
  {
   Comment("AT24 Copier RECEIVER v" + AT24C_VERSION + (DryRun ? "  [DRY RUN]" : "") + (ReverseCopy ? "  [REVERSE]" : "") + "\n",
           "Channel : ", g_chan, "\n",
           "Master  : ", g_masterInfo, "\n",
           "Status  : ", g_status, "\n",
           "Opened ", g_opened, "  Closed ", g_closed, "  SL/TP ", g_modified, "  Skipped ", g_skipped, "  Errors ", g_errors);
  }

int OnInit()
  {
   if(MQLInfoInteger(MQL_TESTER))
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
   g_trade.SetExpertMagicNumber((ulong)ReceiverMagic);
   g_trade.SetDeviationInPoints(MaxSlippagePoints);
   g_trade.SetAsyncMode(false);
   EventSetMillisecondTimer(MathMax(50, PollMilliseconds));
   ShowStatus();
   PrintFormat("[AT24-COPIER] Receiver v%s started - channel '%s' (Common\\Files\\%s)%s. Existing master positions are %s.",
               AT24C_VERSION, g_chan, g_file, DryRun ? " DRY RUN" : "", CopyExistingOnStart ? "COPIED" : "ignored");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTimer()
  {
   if(!DryRun && (!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED)))
     {
      g_status = "algo trading is disabled (enable the Algo Trading button / EA permission)";
      ShowStatus();
      return;
     }
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) || AccountInfoInteger(ACCOUNT_LOGIN) == 0)
     {
      g_status = "no broker connection - waiting";
      ShowStatus();
      return;
     }

   //--- Account facts are only reliable once connected (an EA that loads at terminal start
   //--- can run before the broker session exists), so the account check lives here, not in OnInit.
   long login = (long)AccountInfoInteger(ACCOUNT_LOGIN);
   if(login != g_login)
     {
      g_login    = login;
      g_modeOk   = false;
      g_synced   = false;                 // new account: forget everything learned about the old one
      ArrayResize(g_legacy, 0);
      ArrayResize(g_ignored, 0);
      ArrayResize(g_attId, 0);
      ArrayResize(g_attCount, 0);
      ArrayResize(g_attLastMs, 0);
      g_emptySince = 0;
     }
   if(!g_modeOk)
     {
      if(AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING && !DryRun)
        {
         g_status = "BLOCKED: this is a NETTING account - the MT5 Receiver needs HEDGING (or use DryRun)";
         LogOnce("netting", "This account is NETTING. The MT5 Receiver needs a HEDGING account to mirror positions one-to-one (use DryRun to only watch). No orders will be sent.");
         ShowStatus();
         return;
        }
      g_modeOk = true;
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
