//+------------------------------------------------------------------+
//|                                           AT24LiveSync-MT4.mq4   |
//|  AT24 Live Sync for MetaTrader 4 - READ-ONLY Expert Advisor      |
//|  https://www.algotraders24.ai                                    |
//+------------------------------------------------------------------+
#property copyright   "AT24"
#property link        "https://www.algotraders24.ai"
#property version     "1.00"
#property strict
#property description "Reads your closed orders, balance/equity and open orders and sends them to"
#property description "your AT24 account over HTTPS. It NEVER trades: this file contains no order-send,"
#property description "modify, close or delete functions. It never sends your account number, name,"
#property description "server or any password. Your broker company name is sent ONLY if you switch on"
#property description "ShareBrokerName. Demo accounts only unless you enable AllowLiveAccount."

//--- inputs ---------------------------------------------------------
input string AT24_Token        = "";                           // Device token (AT24 dashboard > Live Sync)
input string AT24_BaseUrl      = "https://www.algotraders24.ai"; // Must be on MT4's allowed-URL list
input int    SyncIntervalSec   = 30;                           // Seconds between syncs (minimum 30)
input bool   AllowLiveAccount  = false;                        // Demo only by default. Enable only if you understand this reads a REAL account
input bool   ShareBrokerName   = false;                        // Off by default. On = send your broker COMPANY name so your results page can show it. Never the account number or server

//--- constants ------------------------------------------------------
#define AT24_VERSION          "1.0"
#define ZERO_HASH             "0000000000000000000000000000000000000000000000000000000000000000"
#define MAX_ORDERS_PER_BATCH  150       // an order is sent as two deals (open + close) = at most 300 deals per batch
#define MAX_BATCHES_PER_CYCLE 5
#define MAX_CANDIDATES        3000
#define MAX_POSITIONS         50
#define SETTLE_SEC            2         // only send orders closed more than this long ago
#define HTTP_TIMEOUT_MS       5000
#define OP_BALANCE_TYPE       6         // MT4 order type used for deposits and withdrawals

//--- one deal as sent (same wire format as the MT5 EA) ---------------
struct DealRec
  {
   ulong  ticket;
   ulong  position;
   long   timeMsc;
   string symbol;
   string type;
   string entry;
   double volume;
   double price;
   double commission;
   double swap;
   double profit;
   double fee;
   long   magic;
   string comment;
  };

//--- state ----------------------------------------------------------
bool     g_ready        = false;   // handshake done
string   g_salt         = "";
string   g_accountKey   = "";
string   g_stateFile    = "";
long     g_seq          = 0;       // last acknowledged batch number
string   g_head         = ZERO_HASH;
long     g_fromSec      = 0;       // orders closed before this second are already acknowledged
long     g_fromTicket   = 0;       // ... and within that second, tickets up to this one
long     g_dealsSent    = 0;
datetime g_lastSync     = 0;
string   g_status       = "starting";
int      g_failures     = 0;
datetime g_backoffUntil = 0;
bool     g_fatal        = false;   // unauthorized: stop hammering the server
bool     g_firstRun     = true;    // the first sync runs from the timer, not from OnInit
long     g_utcOffsetSec = 0;       // last trustworthy server-to-UTC offset
bool     g_offsetKnown  = false;
long     g_prevTick     = 0;
long     g_prevGmt      = 0;
datetime g_oldestOrder  = 0;       // oldest closed order the terminal holds (for the chart note)

// Every status change is shown on the chart AND written to the Experts log, so a
// problem can be diagnosed from the journal without screenshots.
void SetStatus(const string s)
  {
   if(s == g_status)
      return;
   g_status = s;
   Print("AT24 Live Sync: ", s);
  }

//+------------------------------------------------------------------+
//| helpers: numbers, strings, hashing                               |
//+------------------------------------------------------------------+
long CentsOf(const double x)
  {
   const long r = (long)MathRound(MathAbs(x) * 100.0);   // round half away from zero
   return (x < 0.0) ? -r : r;
  }

string Money(const double x)
  {
   return DoubleToString((double)CentsOf(x) / 100.0, 2);
  }

string Sha256Hex(const string text)
  {
   uchar src[], key[], dst[];
   int n = StringToCharArray(text, src, 0, WHOLE_ARRAY, CP_UTF8) - 1;   // drop the terminating zero
   if(n < 0)
      n = 0;
   ArrayResize(src, n);
   ArrayResize(key, 0);
   if(CryptEncode(CRYPT_HASH_SHA256, src, key, dst) <= 0)
      return "";
   string hex = "";
   for(int i = 0; i < ArraySize(dst); i++)
      hex += StringFormat("%02x", dst[i]);
   return hex;
  }

string JsonEsc(const string s, const int maxLen = 64)
  {
   string out = "";
   int n = StringLen(s);
   if(n > maxLen)
      n = maxLen;
   for(int i = 0; i < n; i++)
     {
      const ushort c = StringGetCharacter(s, i);
      if(c == '"')
         out += "\\\"";
      else
         if(c == '\\')
            out += "\\\\";
         else
            if(c < 32 || c == 127)
               out += " ";
            else
               if(c > 126)
                  out += "?";
               else
                  out += ShortToString(c);
     }
   return out;
  }

//--- tiny JSON readers for our own server's flat responses ----------
int JsonFindValue(const string json, const string key)
  {
   const string needle = "\"" + key + "\":";
   const int p = StringFind(json, needle);
   if(p < 0)
      return -1;
   int i = p + StringLen(needle);
   while(i < StringLen(json) && StringGetCharacter(json, i) == ' ')
      i++;
   return i;
  }

long JsonLong(const string json, const string key, const long def)
  {
   int i = JsonFindValue(json, key);
   if(i < 0)
      return def;
   string digits = "";
   while(i < StringLen(json))
     {
      const ushort c = StringGetCharacter(json, i);
      if((c >= '0' && c <= '9') || (c == '-' && digits == ""))
         digits += ShortToString(c);
      else
         break;
      i++;
     }
   if(digits == "" || digits == "-")
      return def;
   return StringToInteger(digits);
  }

string JsonString(const string json, const string key)
  {
   int i = JsonFindValue(json, key);
   if(i < 0 || StringGetCharacter(json, i) != '"')
      return "";
   i++;
   string s = "";
   while(i < StringLen(json))
     {
      const ushort c = StringGetCharacter(json, i);
      if(c == '"')
         break;
      s += ShortToString(c);
      i++;
     }
   return s;
  }

//+------------------------------------------------------------------+
//| account facts (NO identity is sent)                              |
//+------------------------------------------------------------------+
// The ONLY place the account number and server name are read: they are hashed
// together with a per-user salt into an opaque key and are never transmitted.
string ComputeAccountKey(const string salt)
  {
   const string raw = StringFormat("%I64d|%s|%s", (long)AccountNumber(), AccountServer(), salt);
   return Sha256Hex(raw);
  }

string ModeText()
  {
   return IsDemo() ? "demo" : "real";
  }

// Upper-case ASCII letters only (a currency code); built by hand because the string helpers differ between MT4 and MT5.
string UpperAscii(const string s)
  {
   string out = "";
   for(int i = 0; i < StringLen(s); i++)
     {
      ushort c = StringGetCharacter(s, i);
      if(c >= 'a' && c <= 'z')
         c = (ushort)(c - 32);
      out += ShortToString(c);
     }
   return out;
  }

//--- Opt-in only. The ONLY place the broker company name is read. Plain characters only; empty = not sent.
string BrokerFactJson()
  {
   if(!ShareBrokerName)
      return "";
   const string raw = AccountCompany();
   string clean = "";
   for(int i = 0; i < StringLen(raw) && StringLen(clean) < 60; i++)
     {
      const ushort c = StringGetCharacter(raw, i);
      const bool alnum = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
      if(alnum)
         clean += ShortToString(c);
      else
         if(StringLen(clean) > 0 && (c == ' ' || c == '.' || c == ',' || c == '&' || c == '(' || c == ')' || c == '+' || c == '-' || c == '_' || c == '/'))
            clean += ShortToString(c);
     }
   while(StringLen(clean) > 0 && StringGetCharacter(clean, StringLen(clean) - 1) == ' ')
      clean = StringSubstr(clean, 0, StringLen(clean) - 1);
   if(StringLen(clean) < 1)
      return "";
   return ",\"broker\":\"" + clean + "\"";
  }

// MT4 has no always-current server clock: TimeCurrent() is the time of the last tick. The offset is therefore only
// updated while ticks are flowing in real time (their time advances as fast as the PC clock); otherwise the last good
// value is kept. A first value taken on a closed market (weekend) can be off until the market opens.
long ServerUtcOffsetSec()
  {
   const long tick = (long)TimeCurrent();
   const long gmt = (long)TimeGMT();
   const bool flowing = (g_prevTick > 0 && tick > g_prevTick && MathAbs((tick - g_prevTick) - (gmt - g_prevGmt)) <= 10);
   g_prevTick = tick;
   g_prevGmt = gmt;
   const long snapped = (long)MathRound((double)(tick - gmt) / 900.0) * 900;   // snap to 15 minutes (clock skew noise)
   if(MathAbs(snapped) <= 50400 && (flowing || !g_offsetKnown))
     {
      g_utcOffsetSec = snapped;
      g_offsetKnown = true;
     }
   return g_utcOffsetSec;
  }

string AccountFactsJson()
  {
   const string cur = UpperAscii(AccountCurrency());
   string json = StringFormat("{\"currency\":\"%s\",\"mode\":\"%s\",\"marginMode\":\"hedging\",\"leverage\":%I64d,\"serverUtcOffsetSec\":%I64d,\"terminalBuild\":%I64d,\"platform\":\"mt4\"}",
                              JsonEsc(cur, 5), ModeText(), (long)AccountLeverage(), ServerUtcOffsetSec(), (long)TerminalInfoInteger(TERMINAL_BUILD));
   const string broker = BrokerFactJson();
   if(broker != "")
      json = StringSubstr(json, 0, StringLen(json) - 1) + broker + "}";
   return json;
  }

string SnapshotJson()
  {
   string pos = "";
   int count = 0;
   const int total = OrdersTotal();
   for(int i = 0; i < total && count < MAX_POSITIONS; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES))
         continue;
      const int t = OrderType();
      if(t != OP_BUY && t != OP_SELL)   // pending orders are not positions
         continue;
      const string side = (t == OP_BUY) ? "buy" : "sell";
      if(count > 0)
         pos += ",";
      pos += StringFormat("{\"ticket\":%I64d,\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%s,\"priceOpen\":%s,\"sl\":%s,\"tp\":%s,\"profit\":%s,\"timeMsc\":%I64d}",
                          (long)OrderTicket(), JsonEsc(OrderSymbol(), 32), side,
                          DoubleToString(OrderLots(), 8), DoubleToString(OrderOpenPrice(), 8),
                          DoubleToString(OrderStopLoss(), 8), DoubleToString(OrderTakeProfit(), 8),
                          Money(OrderProfit()), (long)OrderOpenTime() * 1000);
      count++;
     }
   return StringFormat("{\"timeMsc\":%I64d,\"balance\":%s,\"equity\":%s,\"margin\":%s,\"freeMargin\":%s,\"positions\":[%s]}",
                       (long)TimeCurrent() * 1000, Money(AccountBalance()), Money(AccountEquity()),
                       Money(AccountMargin()), Money(AccountFreeMargin()), pos);
  }

//+------------------------------------------------------------------+
//| persisted chain state (so a restart resumes without duplicates)  |
//+------------------------------------------------------------------+
void SaveState()
  {
   const int h = FileOpen(g_stateFile, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
      return;
   FileWriteString(h, "seq=" + IntegerToString(g_seq) + "\n");
   FileWriteString(h, "head=" + g_head + "\n");
   FileWriteString(h, "fromSec=" + IntegerToString(g_fromSec) + "\n");
   FileWriteString(h, "fromTicket=" + IntegerToString(g_fromTicket) + "\n");
   FileClose(h);
  }

void LoadState()
  {
   g_seq = 0;
   g_head = ZERO_HASH;
   g_fromSec = 0;
   g_fromTicket = 0;
   const int h = FileOpen(g_stateFile, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE)
      return;
   while(!FileIsEnding(h))
     {
      const string line = FileReadString(h);
      if(StringFind(line, "seq=") == 0)
         g_seq = StringToInteger(StringSubstr(line, 4));
      else
         if(StringFind(line, "head=") == 0)
            g_head = StringSubstr(line, 5);
         else
            if(StringFind(line, "fromSec=") == 0)
               g_fromSec = StringToInteger(StringSubstr(line, 8));
            else
               if(StringFind(line, "fromTicket=") == 0)
                  g_fromTicket = StringToInteger(StringSubstr(line, 11));
     }
   FileClose(h);
   if(StringLen(g_head) != 64)
      g_head = ZERO_HASH;
  }

//+------------------------------------------------------------------+
//| HTTP                                                             |
//+------------------------------------------------------------------+
void ShowStatus()
  {
   string s = "AT24 Live Sync for MT4 v" + AT24_VERSION + " (read-only)\n";
   s += "Status: " + g_status + "\n";
   s += "Account mode: " + ModeText() + "\n";
   s += "Deals sent: " + IntegerToString(g_dealsSent) + "\n";
   if(g_lastSync > 0)
      s += "Last sync: " + TimeToString(g_lastSync, TIME_DATE | TIME_SECONDS) + "\n";
   if(g_oldestOrder > 0)
      s += "History held by this terminal starts: " + TimeToString(g_oldestOrder, TIME_DATE) + " (right-click Account History > All History to sync older trades)\n";
   Comment(s);
  }

// Returns the HTTP status code, or -1 when the request could not be made.
int PostJson(const string path, const string body, string &response)
  {
   char data[], result[];
   string resultHeaders;
   int n = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   if(n < 0)
      n = 0;
   ArrayResize(data, n);
   const string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + AT24_Token + "\r\n";
   ResetLastError();
   const int code = WebRequest("POST", AT24_BaseUrl + path, headers, HTTP_TIMEOUT_MS, data, result, resultHeaders);
   if(code == -1)
     {
      const int err = GetLastError();
      if(err == 4060 || err == 4014) // returned when the URL is not in the allowed list
         SetStatus("ACTION NEEDED: add " + AT24_BaseUrl + " in Tools > Options > Expert Advisors > Allow WebRequest for listed URL");
      else
         SetStatus("network error " + IntegerToString(err) + " (will retry)");
      response = "";
      return -1;
     }
   response = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   return code;
  }

void NoteFailure()
  {
   g_failures++;
   int wait = 30;
   for(int i = 1; i < g_failures && wait < 300; i++)
      wait *= 2;
   if(wait > 300)
      wait = 300;
   g_backoffUntil = TimeCurrent() + wait;
  }

void NoteSuccess()
  {
   g_failures = 0;
   g_backoffUntil = 0;
  }

// Common reaction to non-200 answers. Returns true if the caller should stop this cycle.
bool HandleHttpError(const int code, const string response)
  {
   Print("AT24 Live Sync: server answered HTTP ", code);
   if(code == 401)
     {
      SetStatus("UNAUTHORIZED: check the device token (it may have been revoked)");
      g_fatal = true;
      return true;
     }
   if(code == 503)
     {
      SetStatus("AT24 Live Sync is not switched on yet (will retry)");
      NoteFailure();
      return true;
     }
   if(code == 429)
     {
      SetStatus("rate limited (will retry)");
      NoteFailure();
      return true;
     }
   if(code == 409)
     {
      // Server holds a different position in the chain (e.g. reinstalled EA): adopt it and continue.
      // The server only knows the newest deal TIME, so re-send that whole second: duplicates are ignored by ticket.
      const long expected = JsonLong(response, "expectedSeq", -1);
      const string head = JsonString(response, "chainHead");
      const long lastMsc = JsonLong(response, "lastDealTimeMsc", -1);
      if(expected >= 1 && StringLen(head) == 64)
        {
         g_seq = expected - 1;
         g_head = head;
         if(lastMsc / 1000 > g_fromSec)
           {
            g_fromSec = lastMsc / 1000;
            g_fromTicket = 0;
           }
         SaveState();
         SetStatus("resynchronised with AT24");
         return false;
        }
     }
   SetStatus("server answered " + IntegerToString(code) + " (will retry)");
   NoteFailure();
   return true;
  }

bool Handshake()
  {
   string resp;
   const int code = PostJson("/api/live-sync/v1/handshake", "{\"v\":1}", resp);
   if(code == -1)
     {
      NoteFailure();
      return false;
     }
   if(code != 200)
     {
      HandleHttpError(code, resp);
      return false;
     }
   g_salt = JsonString(resp, "accountSalt");
   if(StringLen(g_salt) != 64)
     {
      SetStatus("unexpected handshake answer");
      NoteFailure();
      return false;
     }
   g_accountKey = ComputeAccountKey(g_salt);
   g_stateFile = "AT24LS4_" + StringSubstr(g_accountKey, 0, 12) + ".state";
   LoadState();
   g_ready = true;
   NoteSuccess();
   SetStatus("connected");
   return true;
  }

//+------------------------------------------------------------------+
//| closed orders -> deals                                           |
//+------------------------------------------------------------------+
// MT4 keeps one record per closed order. The server wants deals, so every closed order is sent as an
// "in" deal (at the open time) and an "out" deal (at the close time), exactly like a one-deal-in, one-deal-out MT5 position.
// Deal tickets are derived from the order ticket (2n = open, 2n+1 = close), so a resend is always recognised.

// MT4 appends "[sl]" / "[tp]" to the comment of an order closed by a stop; remove it so strategy names stay clean.
string CleanComment(const string c)
  {
   const int n = StringLen(c);
   if(n >= 4)
     {
      const string tail = StringSubstr(c, n - 4);
      if(tail == "[sl]" || tail == "[tp]")
         return StringSubstr(c, 0, n - 4);
     }
   return c;
  }

// Fills the open and close deals of the order currently selected (history). Returns how many deals were added (1 or 2).
int AppendOrderDeals(DealRec &out[], int n)
  {
   const int t = OrderType();
   const ulong ticket = (ulong)OrderTicket();
   if(t == OP_BALANCE_TYPE)
     {
      ArrayResize(out, n + 1);
      out[n].ticket     = ticket * 2 + 1;
      out[n].position   = 0;
      out[n].timeMsc    = (long)OrderCloseTime() * 1000;
      out[n].symbol     = "";
      out[n].type       = "balance";
      out[n].entry      = "none";
      out[n].volume     = 0;
      out[n].price      = 0;
      out[n].commission = 0;
      out[n].swap       = 0;
      out[n].profit     = OrderProfit();
      out[n].fee        = 0;
      out[n].magic      = 0;
      out[n].comment    = CleanComment(OrderComment());
      return 1;
     }
   const bool isBuy = (t == OP_BUY);
   ArrayResize(out, n + 2);
   out[n].ticket     = ticket * 2;
   out[n].position   = ticket;
   out[n].timeMsc    = (long)OrderOpenTime() * 1000;
   out[n].symbol     = OrderSymbol();
   out[n].type       = isBuy ? "buy" : "sell";
   out[n].entry      = "in";
   out[n].volume     = OrderLots();
   out[n].price      = OrderOpenPrice();
   out[n].commission = 0;
   out[n].swap       = 0;
   out[n].profit     = 0;
   out[n].fee        = 0;
   out[n].magic      = (long)OrderMagicNumber();
   out[n].comment    = CleanComment(OrderComment());
   out[n + 1].ticket     = ticket * 2 + 1;
   out[n + 1].position   = ticket;
   out[n + 1].timeMsc    = (long)OrderCloseTime() * 1000;
   out[n + 1].symbol     = OrderSymbol();
   out[n + 1].type       = isBuy ? "sell" : "buy";   // the closing deal is the opposite side
   out[n + 1].entry      = "out";
   out[n + 1].volume     = OrderLots();
   out[n + 1].price      = OrderClosePrice();
   out[n + 1].commission = OrderCommission();
   out[n + 1].swap       = OrderSwap();
   out[n + 1].profit     = OrderProfit();
   out[n + 1].fee        = 0;
   out[n + 1].magic      = (long)OrderMagicNumber();
   out[n + 1].comment    = "";
   return 2;
  }

// Collect not-yet-acknowledged, settled orders in ascending (close time, ticket) order and turn up to
// MAX_ORDERS_PER_BATCH of them into deals. lastSec/lastTicket receive the position of the last order taken.
int CollectDeals(DealRec &out[], long &lastSec, long &lastTicket)
  {
   ArrayResize(out, 0);
   lastSec = 0;
   lastTicket = 0;
   const int total = OrdersHistoryTotal();
   const long cutoff = (long)TimeCurrent() - SETTLE_SEC;
   long   cSec[];
   long   cTicket[];
   int    cIndex[];
   int    cn = 0;
   bool   ascending = true;
   g_oldestOrder = 0;
   for(int i = 0; i < total && cn < MAX_CANDIDATES; i++)
     {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY))
         continue;
      const int t = OrderType();
      if(t != OP_BUY && t != OP_SELL && t != OP_BALANCE_TYPE)
         continue;   // cancelled pending orders and credits are not trades
      const long ct = (long)OrderCloseTime();
      if(ct <= 0)
         continue;
      if(g_oldestOrder == 0 || (datetime)ct < g_oldestOrder)
         g_oldestOrder = (datetime)ct;
      const long tk = (long)OrderTicket();
      if(ct > cutoff)
         continue;
      if(ct < g_fromSec || (ct == g_fromSec && tk <= g_fromTicket))
         continue;
      ArrayResize(cSec, cn + 1);
      ArrayResize(cTicket, cn + 1);
      ArrayResize(cIndex, cn + 1);
      if(cn > 0 && (ct < cSec[cn - 1] || (ct == cSec[cn - 1] && tk < cTicket[cn - 1])))
         ascending = false;
      cSec[cn] = ct;
      cTicket[cn] = tk;
      cIndex[cn] = i;
      cn++;
     }
   if(!ascending)   // history is normally close-time ordered; if not, insertion-sort the window
     {
      for(int a = 1; a < cn; a++)
        {
         const long ks = cSec[a], kt = cTicket[a];
         const int ki = cIndex[a];
         int b = a - 1;
         while(b >= 0 && (cSec[b] > ks || (cSec[b] == ks && cTicket[b] > kt)))
           {
            cSec[b + 1] = cSec[b];
            cTicket[b + 1] = cTicket[b];
            cIndex[b + 1] = cIndex[b];
            b--;
           }
         cSec[b + 1] = ks;
         cTicket[b + 1] = kt;
         cIndex[b + 1] = ki;
        }
     }
   const int take = (cn > MAX_ORDERS_PER_BATCH) ? MAX_ORDERS_PER_BATCH : cn;
   int n = 0;
   for(int k = 0; k < take; k++)
     {
      if(!OrderSelect(cIndex[k], SELECT_BY_POS, MODE_HISTORY))
         continue;
      n += AppendOrderDeals(out, n);
      lastSec = cSec[k];
      lastTicket = cTicket[k];
     }
   return n;
  }

string DealJson(const DealRec &d)
  {
   return StringFormat("{\"ticket\":%I64u,\"positionId\":%I64u,\"timeMsc\":%I64d,\"symbol\":\"%s\",\"type\":\"%s\",\"entry\":\"%s\",\"volume\":%s,\"price\":%s,\"commission\":%s,\"swap\":%s,\"profit\":%s,\"fee\":%s,\"magic\":%I64d,\"comment\":\"%s\"}",
                       d.ticket, d.position, d.timeMsc, JsonEsc(d.symbol, 32), d.type, d.entry,
                       DoubleToString(d.volume, 8), DoubleToString(d.price, 8),
                       Money(d.commission), Money(d.swap), Money(d.profit), Money(d.fee), d.magic, JsonEsc(d.comment, 40));
  }

// Must match the server's canonical form exactly (integers only).
string DealCanonical(const DealRec &d)
  {
   return StringFormat("%I64u:%I64d:%I64d:%I64d:%I64d:%I64d", d.ticket, d.timeMsc, CentsOf(d.profit), CentsOf(d.commission), CentsOf(d.swap), CentsOf(d.fee));
  }

// Sends up to MAX_BATCHES_PER_CYCLE batches. Returns the number of deals acknowledged.
int SendNewDeals(bool &stop)
  {
   int acknowledged = 0;
   stop = false;
   for(int batchNo = 0; batchNo < MAX_BATCHES_PER_CYCLE; batchNo++)
     {
      DealRec all[];
      long lastSec = 0, lastTicket = 0;
      const int take = CollectDeals(all, lastSec, lastTicket);
      if(take == 0)
         break;
      const long seq = g_seq + 1;
      string items = "", dealsJson = "";
      for(int i = 0; i < take; i++)
        {
         if(i > 0)
           {
            items += ";";
            dealsJson += ",";
           }
         items += DealCanonical(all[i]);
         dealsJson += DealJson(all[i]);
        }
      const string hash = Sha256Hex(g_head + "|" + IntegerToString(seq) + "|" + items);
      string body = "{\"v\":1,\"accountKey\":\"" + g_accountKey + "\",\"account\":" + AccountFactsJson();
      body += ",\"seq\":" + IntegerToString(seq) + ",\"prevHash\":\"" + g_head + "\",\"hash\":\"" + hash + "\"";
      body += ",\"deals\":[" + dealsJson + "]";
      if(batchNo == 0)
         body += ",\"snapshot\":" + SnapshotJson();
      body += "}";

      string resp;
      const int code = PostJson("/api/live-sync/v1/ingest", body, resp);
      if(code == -1)
        {
         NoteFailure();
         stop = true;
         return acknowledged;
        }
      if(code != 200)
        {
         stop = HandleHttpError(code, resp);
         if(stop)
            return acknowledged;
         continue;   // resynchronised: collect again from the server's position
        }
      g_seq = JsonLong(resp, "ackSeq", seq);
      const string head = JsonString(resp, "chainHead");
      g_head = (StringLen(head) == 64) ? head : hash;
      g_fromSec = lastSec;
      g_fromTicket = lastTicket;
      SaveState();
      g_dealsSent += take;
      acknowledged += take;
      g_lastSync = TimeCurrent();
      NoteSuccess();
      SetStatus("connected");
     }
   return acknowledged;
  }

void SendHeartbeat()
  {
   const string body = "{\"v\":1,\"accountKey\":\"" + g_accountKey + "\",\"account\":" + AccountFactsJson() + ",\"deals\":[],\"snapshot\":" + SnapshotJson() + "}";
   string resp;
   const int code = PostJson("/api/live-sync/v1/ingest", body, resp);
   if(code == -1)
     {
      NoteFailure();
      return;
     }
   if(code != 200)
     {
      HandleHttpError(code, resp);
      return;
     }
   g_lastSync = TimeCurrent();
   NoteSuccess();
   SetStatus("connected");
  }

//+------------------------------------------------------------------+
//| life cycle                                                       |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(AT24_Token) < 20)
     {
      Alert("AT24 Live Sync: paste your device token in the EA inputs (AT24 dashboard > Live Sync).");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(StringFind(AT24_BaseUrl, "https://") != 0)
     {
      Alert("AT24 Live Sync: the base URL must start with https://");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(ModeText() != "demo" && !AllowLiveAccount)
     {
      Alert("AT24 Live Sync: this is not a demo account. Set AllowLiveAccount=true only if you want this EA to read a REAL account.");
      return INIT_FAILED;
     }
   EventSetTimer(1);   // first sync after 1 s, from the timer (network calls are not made inside OnInit)
   SetStatus("starting");
   ShowStatus();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTimer()
  {
   if(g_firstRun)
     {
      g_firstRun = false;
      EventKillTimer();
      EventSetTimer((SyncIntervalSec < 30) ? 30 : SyncIntervalSec);
     }
   if(g_fatal)
     {
      ShowStatus();
      return;
     }
   if(g_backoffUntil > TimeCurrent())
     {
      ShowStatus();
      return;
     }
   if(!g_ready && !Handshake())
     {
      ShowStatus();
      return;
     }
   bool stop = false;
   const int sent = SendNewDeals(stop);
   if(!stop && sent == 0)
      SendHeartbeat();
   ShowStatus();
  }

void OnTick()
  {
   // Intentionally empty: everything runs from the timer.
  }
//+------------------------------------------------------------------+
