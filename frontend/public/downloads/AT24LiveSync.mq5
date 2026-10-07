//+------------------------------------------------------------------+
//|                                              AT24LiveSync.mq5    |
//|  AT24 Live Sync - READ-ONLY Expert Advisor (v1.0, prototype)     |
//|  https://www.algotraders24.ai                                    |
//+------------------------------------------------------------------+
#property copyright   "AT24"
#property link        "https://www.algotraders24.ai"
#property version     "1.00"
#property description "Reads your closed deals, balance/equity and open positions and sends them to"
#property description "your AT24 account over HTTPS. It NEVER trades: this file contains no order,"
#property description "position-modify or close functions. It never sends your account number, name,"
#property description "server or any password. Demo accounts only unless you enable AllowLiveAccount."

//--- inputs ---------------------------------------------------------
input string AT24_Token        = "";                           // Device token (AT24 dashboard > Live Sync)
input string AT24_BaseUrl      = "https://www.algotraders24.ai"; // Must be on MT5's allowed-URL list
input int    SyncIntervalSec   = 30;                           // Seconds between syncs (minimum 30)
input bool   AllowLiveAccount  = false;                        // Demo only by default. Enable only if you understand this reads a REAL account

//--- constants ------------------------------------------------------
#define AT24_VERSION          "1.0 prototype"
#define ZERO_HASH             "0000000000000000000000000000000000000000000000000000000000000000"
#define MAX_DEALS_PER_BATCH   300
#define MAX_BATCHES_PER_CYCLE 5
#define MAX_CANDIDATES        2000
#define MAX_POSITIONS         50
#define SETTLE_MS             2000      // only send deals older than this (all deals of the same ms are present)
#define HTTP_TIMEOUT_MS       5000

//--- one deal as sent -----------------------------------------------
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
long     g_fromMsc      = 0;       // deals with time <= this are already acknowledged
long     g_dealsSent    = 0;
datetime g_lastSync     = 0;
string   g_status       = "starting";
int      g_failures     = 0;
datetime g_backoffUntil = 0;
bool     g_fatal        = false;   // unauthorized: stop hammering the server
bool     g_firstRun     = true;    // the first sync runs from the timer, not from OnInit

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
   const string raw = StringFormat("%I64d|%s|%s", AccountInfoInteger(ACCOUNT_LOGIN), AccountInfoString(ACCOUNT_SERVER), salt);
   return Sha256Hex(raw);
  }

string ModeText()
  {
   const ENUM_ACCOUNT_TRADE_MODE m = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(m == ACCOUNT_TRADE_MODE_DEMO)
      return "demo";
   if(m == ACCOUNT_TRADE_MODE_CONTEST)
      return "contest";
   return "real";
  }

string MarginModeText()
  {
   const ENUM_ACCOUNT_MARGIN_MODE m = (ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE);
   return (m == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING) ? "hedging" : "netting";
  }

string AccountFactsJson()
  {
   long off = (long)(TimeTradeServer() - TimeGMT());
   off = (long)MathRound((double)off / 900.0) * 900;           // snap to 15 minutes (clock skew noise)
   if(off > 50400)
      off = 50400;
   if(off < -50400)
      off = -50400;
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   StringToUpper(cur);
   return StringFormat("{\"currency\":\"%s\",\"mode\":\"%s\",\"marginMode\":\"%s\",\"leverage\":%I64d,\"serverUtcOffsetSec\":%I64d,\"terminalBuild\":%I64d}",
                       JsonEsc(cur, 5), ModeText(), MarginModeText(), AccountInfoInteger(ACCOUNT_LEVERAGE), off, TerminalInfoInteger(TERMINAL_BUILD));
  }

string SnapshotJson()
  {
   string pos = "";
   int count = 0;
   const int total = PositionsTotal();
   for(int i = 0; i < total && count < MAX_POSITIONS; i++)
     {
      const ulong tk = PositionGetTicket(i);
      if(tk == 0)
         continue;
      const string side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "buy" : "sell";
      if(count > 0)
         pos += ",";
      pos += StringFormat("{\"ticket\":%I64u,\"symbol\":\"%s\",\"side\":\"%s\",\"volume\":%s,\"priceOpen\":%s,\"sl\":%s,\"tp\":%s,\"profit\":%s,\"timeMsc\":%I64d}",
                          tk, JsonEsc(PositionGetString(POSITION_SYMBOL), 32), side,
                          DoubleToString(PositionGetDouble(POSITION_VOLUME), 8), DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), 8),
                          DoubleToString(PositionGetDouble(POSITION_SL), 8), DoubleToString(PositionGetDouble(POSITION_TP), 8),
                          Money(PositionGetDouble(POSITION_PROFIT)), PositionGetInteger(POSITION_TIME_MSC));
      count++;
     }
   return StringFormat("{\"timeMsc\":%I64d,\"balance\":%s,\"equity\":%s,\"margin\":%s,\"freeMargin\":%s,\"positions\":[%s]}",
                       (long)TimeCurrent() * 1000, Money(AccountInfoDouble(ACCOUNT_BALANCE)), Money(AccountInfoDouble(ACCOUNT_EQUITY)),
                       Money(AccountInfoDouble(ACCOUNT_MARGIN)), Money(AccountInfoDouble(ACCOUNT_MARGIN_FREE)), pos);
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
   FileWriteString(h, "from=" + IntegerToString(g_fromMsc) + "\n");
   FileClose(h);
  }

void LoadState()
  {
   g_seq = 0;
   g_head = ZERO_HASH;
   g_fromMsc = 0;
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
            if(StringFind(line, "from=") == 0)
               g_fromMsc = StringToInteger(StringSubstr(line, 5));
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
   string s = "AT24 Live Sync v" + AT24_VERSION + " (read-only)\n";
   s += "Status: " + g_status + "\n";
   s += "Account mode: " + ModeText() + "\n";
   s += "Deals sent: " + IntegerToString(g_dealsSent) + "\n";
   if(g_lastSync > 0)
      s += "Last sync: " + TimeToString(g_lastSync, TIME_DATE | TIME_SECONDS) + "\n";
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
      if(err == 4060)
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
      const long expected = JsonLong(response, "expectedSeq", -1);
      const string head = JsonString(response, "chainHead");
      const long lastMsc = JsonLong(response, "lastDealTimeMsc", -1);
      if(expected >= 1 && StringLen(head) == 64)
        {
         g_seq = expected - 1;
         g_head = head;
         if(lastMsc > g_fromMsc)
            g_fromMsc = lastMsc;
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
   g_stateFile = "AT24LS_" + StringSubstr(g_accountKey, 0, 12) + ".state";
   LoadState();
   g_ready = true;
   NoteSuccess();
   SetStatus("connected");
   return true;
  }

//+------------------------------------------------------------------+
//| deals                                                            |
//+------------------------------------------------------------------+
string DealTypeText(const long t)
  {
   if(t == DEAL_TYPE_BUY)
      return "buy";
   if(t == DEAL_TYPE_SELL)
      return "sell";
   if(t == DEAL_TYPE_BALANCE)
      return "balance";
   return "other";
  }

string DealEntryText(const long e)
  {
   if(e == DEAL_ENTRY_IN)
      return "in";
   if(e == DEAL_ENTRY_OUT || e == DEAL_ENTRY_OUT_BY)
      return "out";
   if(e == DEAL_ENTRY_INOUT)
      return "inout";
   return "none";
  }

// Collect not-yet-acknowledged, settled deals in ascending (time, ticket) order.
int CollectDeals(DealRec &out[])
  {
   ArrayResize(out, 0);
   const datetime now = TimeCurrent();
   const long cutoff = (long)now * 1000 - SETTLE_MS;
   const datetime from = (datetime)(g_fromMsc / 1000);
   if(!HistorySelect(from, now + 60))
      return 0;
   const int total = HistoryDealsTotal();
   bool ascending = true;
   long prev = 0;
   int n = 0;
   for(int i = 0; i < total && n < MAX_CANDIDATES; i++)
     {
      const ulong tk = HistoryDealGetTicket(i);
      if(tk == 0)
         continue;
      const long tm = HistoryDealGetInteger(tk, DEAL_TIME_MSC);
      if(tm <= g_fromMsc || tm > cutoff)
         continue;
      if(tm < prev)
         ascending = false;
      prev = tm;
      ArrayResize(out, n + 1);
      out[n].ticket     = tk;
      out[n].position   = (ulong)HistoryDealGetInteger(tk, DEAL_POSITION_ID);
      out[n].timeMsc    = tm;
      out[n].symbol     = HistoryDealGetString(tk, DEAL_SYMBOL);
      out[n].type       = DealTypeText(HistoryDealGetInteger(tk, DEAL_TYPE));
      out[n].entry      = DealEntryText(HistoryDealGetInteger(tk, DEAL_ENTRY));
      out[n].volume     = HistoryDealGetDouble(tk, DEAL_VOLUME);
      out[n].price      = HistoryDealGetDouble(tk, DEAL_PRICE);
      out[n].commission = HistoryDealGetDouble(tk, DEAL_COMMISSION);
      out[n].swap       = HistoryDealGetDouble(tk, DEAL_SWAP);
      out[n].profit     = HistoryDealGetDouble(tk, DEAL_PROFIT);
      out[n].fee        = HistoryDealGetDouble(tk, DEAL_FEE);
      out[n].magic      = HistoryDealGetInteger(tk, DEAL_MAGIC);
      out[n].comment    = HistoryDealGetString(tk, DEAL_COMMENT);
      n++;
     }
   if(!ascending)   // history is normally time-ordered; if not, insertion-sort the (small) window
     {
      for(int a = 1; a < n; a++)
        {
         DealRec key = out[a];
         int b = a - 1;
         while(b >= 0 && (out[b].timeMsc > key.timeMsc || (out[b].timeMsc == key.timeMsc && out[b].ticket > key.ticket)))
           {
            out[b + 1] = out[b];
            b--;
           }
         out[b + 1] = key;
        }
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
      const int found = CollectDeals(all);
      if(found == 0)
         break;
      const int take = (found > MAX_DEALS_PER_BATCH) ? MAX_DEALS_PER_BATCH : found;
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
      g_fromMsc = all[take - 1].timeMsc;
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
