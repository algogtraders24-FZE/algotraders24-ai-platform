//+------------------------------------------------------------------+
//|                                               AT24Execute.mq5    |
//|  AT24 Execute - places the orders YOU confirm in the AT24 chart  |
//|  https://www.algotraders24.ai                         (v1.0)     |
//+------------------------------------------------------------------+
#property copyright   "AT24"
#property link        "https://www.algotraders24.ai"
#property version     "1.00"
#property description "Places an order in YOUR MetaTrader 5 only after you press Confirm in the AT24 Pro Chart."
#property description "It asks your AT24 account for confirmed orders every few seconds over HTTPS and applies"
#property description "its own safety checks first (stop loss required, lot cap, symbol, price, open-position and"
#property description "daily-loss limits). It never sends your account number, name, server or password."
#property description "Demo accounts only unless you enable AllowLiveAccount. It never opens a trade on its own."

#include <Trade\Trade.mqh>

//--- inputs ---------------------------------------------------------
input string AT24_Token         = "";                           // Execute token (AT24 dashboard > Live Sync > Execute EA)
input string AT24_BaseUrl       = "https://www.algotraders24.ai"; // Must be on MT5's allowed-URL list
input int    PollSeconds        = 3;                            // Seconds between checks for a confirmed order (minimum 2)
input bool   AllowLiveAccount   = false;                        // Demo only by default. Enable only if you understand this can place orders on a REAL account
input double MaxLots            = 0.10;                         // Largest lot size this EA will ever send, whatever AT24 says
input int    MaxSlippagePoints  = 30;                           // Market orders: refused when the price moved more than this from the plan
input int    MaxSpreadPoints    = 0;                            // Refuse when the spread is wider than this (0 = no spread filter)
input int    MaxOpenPositions   = 5;                            // Open positions plus pending orders of this EA allowed at the same time
input double MaxDailyLossPercent = 5.0;                         // Refuse new orders once equity fell this % since the first check of the UTC day (0 = off)
input string SymbolSuffix       = "";                           // Optional. Leave empty: the EA finds your broker's name by itself (BTCUSDm, EURUSD.a, #EURUSD ...)
input long   MagicNumber        = 240024;                       // Magic number put on every order of this EA
input bool   DryRun             = false;                        // Test mode: every order is read, checked and REFUSED with "dry run" (nothing is placed)

//--- constants ------------------------------------------------------
#define AT24_VERSION     "1.0"
#define HTTP_TIMEOUT_MS  5000
#define TOKEN_PREFIX     "at24_exec_"
#define GV_PREFIX        "AT24X_"

//--- state ----------------------------------------------------------
string   g_status       = "starting";
bool     g_fatal        = false;     // unauthorized or live account without permission: stop
int      g_failures     = 0;
datetime g_backoffUntil = 0;
datetime g_lastPoll     = 0;
long     g_clockOffset  = 0;         // server clock minus this PC's GMT clock, seconds (from the poll answer)
int      g_handled      = 0;
string   g_lastResult   = "none yet";
CTrade   g_trade;

//+------------------------------------------------------------------+
//| helpers                                                          |
//+------------------------------------------------------------------+
void SetStatus(const string s)
  {
   if(s == g_status)
      return;
   g_status = s;
   Print("AT24 Execute: ", s);
  }

string ModeText()
  {
   const ENUM_ACCOUNT_TRADE_MODE m = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(m == ACCOUNT_TRADE_MODE_DEMO)
      return "demo";
   if(m == ACCOUNT_TRADE_MODE_CONTEST)
      return "contest";
   return "REAL";
  }

void ShowStatus()
  {
   string s = "AT24 Execute v" + AT24_VERSION + (DryRun ? " (DRY RUN)" : "") + "\n";
   s += "Status: " + g_status + "\n";
   s += "Account mode: " + ModeText() + "\n";
   s += "Orders handled: " + IntegerToString(g_handled) + "\n";
   s += "Last result: " + g_lastResult + "\n";
   Comment(s);
  }

string JsonEscape(const string s)
  {
   string out = "";
   const int n = StringLen(s);
   for(int i = 0; i < n && i < 160; i++)
     {
      const ushort c = StringGetCharacter(s, i);
      if(c == '"' || c == '\\')
         out += " ";
      else
         if(c < 32)
            out += " ";
         else
            out += ShortToString(c);
     }
   return out;
  }

string JsonStr(const string json, const string key)
  {
   const string pat = "\"" + key + "\":\"";
   int p = StringFind(json, pat);
   if(p < 0)
      return "";
   p += StringLen(pat);
   const int e = StringFind(json, "\"", p);
   if(e < 0)
      return "";
   return StringSubstr(json, p, e - p);
  }

bool JsonNum(const string json, const string key, double &out)
  {
   const string pat = "\"" + key + "\":";
   int p = StringFind(json, pat);
   if(p < 0)
      return false;
   p += StringLen(pat);
   if(StringSubstr(json, p, 4) == "null")
      return false;
   int e = p;
   const int n = StringLen(json);
   while(e < n)
     {
      const ushort c = StringGetCharacter(json, e);
      if(!((c >= '0' && c <= '9') || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E'))
         break;
      e++;
     }
   if(e == p)
      return false;
   out = StringToDouble(StringSubstr(json, p, e - p));
   return true;
  }

// "2026-11-23T12:00:00.000Z" -> datetime (GMT value); 0 when it does not look like an ISO time
datetime ParseIso(const string iso)
  {
   if(StringLen(iso) < 19)
      return 0;
   const string s = StringSubstr(iso, 0, 4) + "." + StringSubstr(iso, 5, 2) + "." + StringSubstr(iso, 8, 2) + " " + StringSubstr(iso, 11, 8);
   return StringToTime(s);
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
      if(err == 4060 || err == 4014)
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
   int wait = 5;
   for(int i = 1; i < g_failures && wait < 120; i++)
      wait *= 2;
   if(wait > 120)
      wait = 120;
   g_backoffUntil = TimeCurrent() + wait;
  }


bool SymbolExistsIn(const string name)
  {
   return SymbolInfoInteger(name, SYMBOL_EXIST) != 0;
  }

// Finds this broker's name for a plain instrument id (BTCUSD -> BTCUSDm, EURUSD.a, #EURUSD ...). Tried in order: the SymbolSuffix input, the plain name,
// then the broker's symbol list: the name must contain the id, and the characters next to it must not be capitals or digits (so EURUSDT is never taken for EURUSD).
string ResolveOne(const string base)
  {
   if(StringLen(SymbolSuffix) > 0 && SymbolExistsIn(base + SymbolSuffix))
      return base + SymbolSuffix;
   if(SymbolExistsIn(base))
      return base;
   string want = base;
   StringToUpper(want);
   string best = "";
   int bestExtra = 1000;
   const int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
     {
      const string name = SymbolName(i, false);
      string up = name;
      StringToUpper(up);
      const int at = StringFind(up, want);
      if(at < 0)
         continue;
      const int extra = StringLen(name) - StringLen(base);
      if(extra <= 0 || extra > 8)
         continue;
      if(at > 0)
        {
         const int before = StringGetCharacter(name, at - 1);
         if((before >= 'A' && before <= 'Z') || (before >= '0' && before <= '9'))
            continue;
        }
      const int endAt = at + StringLen(base);
      if(endAt < StringLen(name))
        {
         const int after = StringGetCharacter(name, endAt);
         if((after >= 'A' && after <= 'Z') || (after >= '0' && after <= '9'))
            continue;
        }
      if(extra < bestExtra)
        {
         best = name;
         bestExtra = extra;
        }
     }
   if(StringLen(best) > 0)
      Print("AT24 Execute: using the broker symbol ", best, " for ", base);
   return best;
  }

// Other names brokers use for the same instrument (the id AT24 sends -> alternatives, comma separated)
string AliasesOf(const string base)
  {
   string b = base;
   StringToUpper(b);
   if(b == "XAUUSD") return "GOLD,XAUUSD.,GOLDUSD";
   if(b == "XAGUSD") return "SILVER,SILVERUSD";
   if(b == "USOIL")  return "WTI,XTIUSD,USOUSD,USOILCash,CL-OIL,WTIUSD";
   if(b == "UKOIL")  return "BRENT,XBRUSD,UKOUSD,BRENTUSD";
   if(b == "US30")   return "DJ30,DJI30,WS30,US30Cash,DOW30";
   if(b == "US500")  return "SPX500,SP500,US500Cash,SPX";
   if(b == "USTEC")  return "NAS100,NDX100,USTECH,NAS100Cash,US100,USTECH100";
   if(b == "US100")  return "NAS100,USTEC,NDX100,USTECH";
   if(b == "DE40")   return "GER40,DAX40,DE40Cash,DAX,GER30";
   if(b == "UK100")  return "FTSE100,UK100Cash,FTSE";
   if(b == "JP225")  return "JPN225,NIKKEI225,Nikkei225,JP225Cash";
   if(b == "BTCUSD") return "BITCOIN,BTCUSD.";
   if(b == "ETHUSD") return "ETHEREUM,ETHUSD.";
   return "";
  }

string ResolveSymbol(const string base)
  {
   string r = ResolveOne(base);
   if(StringLen(r) > 0)
      return r;
   string parts[];
   const int n = StringSplit(AliasesOf(base), ',', parts);
   for(int i = 0; i < n; i++)
     {
      r = ResolveOne(parts[i]);
      if(StringLen(r) > 0)
        {
         Print("AT24 Execute: ", base, " is called ", r, " at this broker");
         return r;
        }
     }
   return "";
  }

//+------------------------------------------------------------------+
//| report the result of one order back to AT24                      |
//+------------------------------------------------------------------+
void Report(const string orderId, const string outcome, const string ticket, const double price, const int retcode, const string reason)
  {
   string body = "{\"orderId\":\"" + orderId + "\",\"outcome\":\"" + outcome + "\"";
   if(StringLen(ticket) > 0)
      body += ",\"ticket\":\"" + ticket + "\"";
   if(price > 0.0)
      body += ",\"price\":" + DoubleToString(price, 8);
   if(retcode != 0)
      body += ",\"retcode\":" + IntegerToString(retcode);
   if(StringLen(reason) > 0)
      body += ",\"reason\":\"" + JsonEscape(reason) + "\"";
   body += "}";
   for(int attempt = 0; attempt < 3; attempt++)
     {
      string resp;
      const int code = PostJson("/api/exec/v1/report", body, resp);
      if(code == 200)
         return;
      if(code == 401)
        {
         g_fatal = true;
         return;
        }
      Sleep(500);
     }
   Print("AT24 Execute: could not report order ", orderId, " (", outcome, "); it will show as 'unknown' in AT24");
  }

//+------------------------------------------------------------------+
//| the ONLY function that sends trade requests                      |
//+------------------------------------------------------------------+
bool ExecuteOrder(const string sym, const bool isBuy, const bool isLimit, const double lots, const double price, const double sl, const double tp, const int secondsToLive, ulong &ticket, double &fill, int &retcode)
  {
   g_trade.SetExpertMagicNumber((ulong)MagicNumber);
   g_trade.SetDeviationInPoints((ulong)MaxSlippagePoints);
   g_trade.SetTypeFillingBySymbol(sym);
   bool sent;
   if(!isLimit)
      sent = isBuy ? g_trade.Buy(lots, sym, 0.0, sl, tp, "AT24") : g_trade.Sell(lots, sym, 0.0, sl, tp, "AT24");
   else
     {
      const datetime expiry = TimeCurrent() + secondsToLive;
      sent = isBuy ? g_trade.BuyLimit(lots, price, sym, sl, tp, ORDER_TIME_SPECIFIED, expiry, "AT24")
             : g_trade.SellLimit(lots, price, sym, sl, tp, ORDER_TIME_SPECIFIED, expiry, "AT24");
     }
   retcode = (int)g_trade.ResultRetcode();
   ticket = g_trade.ResultOrder();
   fill = g_trade.ResultPrice();
   return sent && (retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_PLACED || retcode == TRADE_RETCODE_DONE_PARTIAL);
  }

//+------------------------------------------------------------------+
//| our own checks, then execute                                     |
//+------------------------------------------------------------------+
int OwnOpenCount()
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      const ulong t = PositionGetTicket(i);
      if(t > 0 && PositionGetInteger(POSITION_MAGIC) == MagicNumber)
         n++;
     }
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      const ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetInteger(ORDER_MAGIC) == MagicNumber)
         n++;
     }
   return n;
  }

// equity at the first check of the UTC day (stored in a terminal global variable), so a restart does not reset the baseline
double DayStartEquity()
  {
   const string key = GV_PREFIX + "DAY_" + TimeToString(TimeGMT(), TIME_DATE);
   if(!GlobalVariableCheck(key))
      GlobalVariableSet(key, AccountInfoDouble(ACCOUNT_EQUITY));
   return GlobalVariableGet(key);
  }

// Returns "" when the order may be sent, otherwise the reason it is refused.
string Check(const string sym, const bool isBuy, const bool isLimit, const double lots, const double price, const double sl, const double tp, const int secondsToLive)
  {
   if(DryRun)
      return "dry run: nothing was placed";
   if(secondsToLive <= 0)
      return "the order expired before this EA could place it";
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
      return "algo trading is switched off in this terminal or for this EA";
   if(!SymbolSelect(sym, true))
      return "symbol " + sym + " was not found at this broker";
   if((ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(sym, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_FULL)
      return "trading is not fully enabled for " + sym + " right now";
   if(sl <= 0.0)
      return "a stop loss is required";
   if(lots > MaxLots + 1e-9)
      return "lot size " + DoubleToString(lots, 2) + " is above this EA's MaxLots " + DoubleToString(MaxLots, 2);
   const double bid = SymbolInfoDouble(sym, SYMBOL_BID);
   const double ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   const double point = SymbolInfoDouble(sym, SYMBOL_POINT);
   if(bid <= 0.0 || ask <= 0.0 || point <= 0.0)
      return "no price for " + sym + " yet";
   if(MaxSpreadPoints > 0 && (ask - bid) / point > MaxSpreadPoints)
      return "spread is wider than MaxSpreadPoints";
   if(OwnOpenCount() >= MaxOpenPositions)
      return "MaxOpenPositions reached";
   if(MaxDailyLossPercent > 0.0)
     {
      const double start = DayStartEquity();
      if(start > 0.0 && (start - AccountInfoDouble(ACCOUNT_EQUITY)) / start * 100.0 >= MaxDailyLossPercent)
         return "daily loss limit reached";
     }
   const double ref = isBuy ? ask : bid;
   if(isBuy && !(sl < ref))
      return "stop loss is not below the buy price";
   if(!isBuy && !(sl > ref))
      return "stop loss is not above the sell price";
   if(tp > 0.0 && isBuy && !(tp > ref))
      return "take profit is not above the buy price";
   if(tp > 0.0 && !isBuy && !(tp < ref))
      return "take profit is not below the sell price";
   if(!isLimit && price > 0.0 && MathAbs(ref - price) / point > MaxSlippagePoints)
      return "price moved " + DoubleToString(MathAbs(ref - price) / point, 0) + " points from the plan (MaxSlippagePoints " + IntegerToString(MaxSlippagePoints) + ")";
   if(isLimit)
     {
      if(price <= 0.0)
         return "a limit order needs a price";
      if(isBuy && !(price < ask))
         return "buy limit is not below the current price";
      if(!isBuy && !(price > bid))
         return "sell limit is not above the current price";
     }
   return "";
  }

void ProcessOrder(const string orderJson)
  {
   const string id = JsonStr(orderJson, "id");
   if(StringLen(id) < 8)
      return;
   const string gv = GV_PREFIX + "ORDER_" + id;
   if(GlobalVariableCheck(gv))
     {
      Report(id, "refused", "", 0.0, 0, "this order id was already handled by this terminal");
      return;
     }
   GlobalVariableSet(gv, (double)TimeCurrent()); // marked BEFORE anything is sent: a restart can never place it twice

   const string symRaw = JsonStr(orderJson, "symbol");
   const string side = JsonStr(orderJson, "side");
   const string kind = JsonStr(orderJson, "kind");
   double volume = 0.0, price = 0.0, sl = 0.0, tp = 0.0;
   JsonNum(orderJson, "volume", volume);
   JsonNum(orderJson, "price", price);
   JsonNum(orderJson, "stopLoss", sl);
   JsonNum(orderJson, "takeProfit", tp);
   const datetime expires = ParseIso(JsonStr(orderJson, "expiresAt"));
   g_handled++;

   if(StringLen(symRaw) < 3 || (side != "buy" && side != "sell") || (kind != "market" && kind != "limit") || volume <= 0.0)
     {
      g_lastResult = "refused: unreadable order";
      Report(id, "refused", "", 0.0, 0, "the order could not be read");
      return;
     }
   const string sym = ResolveSymbol(symRaw);
   if(StringLen(sym) == 0)
     {
      g_lastResult = "refused: symbol not found at this broker";
      Report(id, "refused", "", 0.0, 0, "symbol " + symRaw + " was not found at this broker");
      return;
     }
   const bool isBuy = (side == "buy");
   const bool isLimit = (kind == "limit");

   // round the lots down to the broker's step; refuse when below the minimum
   double lots = volume;
   if(SymbolSelect(sym, true))
     {
      const double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
      const double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
      const double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
      if(step > 0.0)
         lots = MathFloor(volume / step + 1e-9) * step;
      if(lots < vmin - 1e-12)
        {
         g_lastResult = "refused: lot size below the broker minimum";
         Report(id, "refused", "", 0.0, 0, "lot size is below this broker's minimum for " + sym);
         return;
        }
      if(vmax > 0.0 && lots > vmax)
         lots = vmax;
     }

   const long nowAdj = (long)TimeGMT() + g_clockOffset;
   const int secondsToLive = (expires > 0) ? (int)((long)expires - nowAdj) : 0;
   const string why = Check(sym, isBuy, isLimit, lots, price, sl, tp, secondsToLive);
   if(StringLen(why) > 0)
     {
      g_lastResult = "refused: " + why;
      Report(id, "refused", "", 0.0, 0, why);
      return;
     }

   ulong ticket = 0;
   double fill = 0.0;
   int retcode = 0;
   const bool ok = ExecuteOrder(sym, isBuy, isLimit, lots, price, sl, tp, secondsToLive, ticket, fill, retcode);
   if(ok)
     {
      GlobalVariableSet(gv, (double)ticket);
      g_lastResult = (isLimit ? "limit placed #" : "filled #") + IntegerToString((long)ticket);
      Report(id, isLimit ? "placed" : "filled", IntegerToString((long)ticket), fill, retcode, "");
     }
   else
     {
      const string txt = g_trade.ResultRetcodeDescription();
      g_lastResult = "refused by the broker: " + txt;
      Report(id, "refused", "", 0.0, retcode, "broker: " + txt);
     }
  }

//+------------------------------------------------------------------+
//| polling                                                          |
//+------------------------------------------------------------------+
void PollOnce()
  {
   string resp;
   const int code = PostJson("/api/exec/v1/poll", "{}", resp);
   if(code == -1)
     {
      NoteFailure();
      return;
     }
   if(code == 401)
     {
      SetStatus("UNAUTHORIZED: check the execute token (it may have been revoked)");
      g_fatal = true;
      return;
     }
   if(code == 503)
     {
      SetStatus("AT24 execute bridge is not switched on yet (will retry)");
      NoteFailure();
      return;
     }
   if(code == 429)
     {
      SetStatus("rate limited (will retry)");
      NoteFailure();
      return;
     }
   if(code != 200)
     {
      SetStatus("server answered HTTP " + IntegerToString(code) + " (will retry)");
      NoteFailure();
      return;
     }
   g_failures = 0;
   g_backoffUntil = 0;
   const datetime srv = ParseIso(JsonStr(resp, "serverTime"));
   if(srv > 0)
      g_clockOffset = (long)srv - (long)TimeGMT();
   SetStatus("connected, waiting for an order you confirm in AT24");
   const int p = StringFind(resp, "\"order\":{");
   if(p >= 0)
      ProcessOrder(StringSubstr(resp, p + 8));
  }

//+------------------------------------------------------------------+
//| events                                                           |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(AT24_Token) < 20 || StringFind(AT24_Token, TOKEN_PREFIX) != 0)
     {
      SetStatus("enter the EXECUTE token from your AT24 dashboard (it starts with " + TOKEN_PREFIX + ")");
      g_fatal = true;
     }
   else
      if(ModeText() == "REAL" && !AllowLiveAccount)
        {
         SetStatus("this is a REAL account: set AllowLiveAccount=true only if you really want orders placed here");
         g_fatal = true;
        }
      else
         if(MaxLots <= 0.0 || MaxSlippagePoints < 0)
           {
            SetStatus("check the inputs: MaxLots must be above 0");
            g_fatal = true;
           }
   if(!MQLInfoInteger(MQL_TRADE_ALLOWED))
      Print("AT24 Execute: 'Allow Algo Trading' is off for this EA; orders will be refused until it is on.");
   EventSetTimer(1);
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
   if(!g_fatal)
     {
      const datetime now = TimeCurrent();
      const int every = (PollSeconds < 2) ? 2 : PollSeconds;
      if(now >= g_backoffUntil && (g_lastPoll == 0 || now - g_lastPoll >= every))
        {
         g_lastPoll = now;
         PollOnce();
        }
     }
   ShowStatus();
  }

void OnTick()
  {
  }
