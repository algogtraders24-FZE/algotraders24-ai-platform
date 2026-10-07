//+------------------------------------------------------------------+
//| AT24_Copier_Proto.mqh                                            |
//| AT24 Local Trade Copier - shared protocol (MQL4 + MQL5).         |
//|                                                                  |
//| A Master EA writes a snapshot of its open positions to a text    |
//| file in the terminal COMMON folder; a Receiver EA (same PC, any  |
//| MT4/MT5 terminal) reads it and mirrors the positions. No server, |
//| no DLL, no network: both sides only touch Common\Files.          |
//|                                                                  |
//| File format (ASCII, one record per line, '|' separated):         |
//|   AT24COPY|1|channel|platform|seq|writeGmt|login|equity|balance|n|
//|   P|id|symbol|side|volume|price|sl|tp|openGmt|magic              |
//|   END|<CRC32 of every byte above, 8 hex digits>                  |
//| A reader that sees a missing END line or a CRC mismatch (writer  |
//| mid-write) simply skips that cycle - it never acts on a partial  |
//| file.                                                            |
//|                                                                  |
//| Only pure functions + plain file helpers live here, so the same  |
//| source compiles unchanged for MetaTrader 4 and MetaTrader 5.     |
//+------------------------------------------------------------------+
#ifndef AT24_COPIER_PROTO_MQH
#define AT24_COPIER_PROTO_MQH

#define AT24C_VERSION       "1.0.0"
#define AT24C_PROTO_TAG     "AT24COPY"
#define AT24C_PROTO_VER     1
#define AT24C_MAX_POS       300
#define AT24C_COMMENT_TAG   "AT24C:"

enum ENUM_AT24C_LOT_MODE
  {
   AT24C_LOT_MULTIPLIER   = 0,   // master lot x multiplier
   AT24C_LOT_FIXED        = 1,   // always the same lot
   AT24C_LOT_EQUITY_RATIO = 2    // master lot x (my equity / master equity) x multiplier
  };

enum ENUM_AT24C_STOPS_POLICY
  {
   AT24C_STOPS_SKIP  = 0,        // broker rejects the master's SL/TP distance -> do not copy the trade
   AT24C_STOPS_CLAMP = 1         // move SL/TP out to the broker minimum distance (risk changes!)
  };

struct SCopyPos
  {
   long   id;        // master position id (MT5: POSITION_IDENTIFIER, MT4: ticket)
   string symbol;    // master symbol, raw
   int    side;      // 0 = buy, 1 = sell
   double volume;
   double price;     // master open price
   double sl;        // 0 = none
   double tp;        // 0 = none
   long   openGmt;   // master open time, seconds, GMT
   long   magic;
  };

struct SCopyHeader
  {
   string channel;
   string platform;  // "MT4" / "MT5"
   long   seq;
   long   writeGmt;  // seconds, GMT - liveness
   long   login;
   double equity;
   double balance;
   int    count;
  };

//+------------------------------------------------------------------+
//| Small portable helpers                                           |
//+------------------------------------------------------------------+
int AT24C_CharAt(const string s, const int i)
  {
#ifdef __MQL5__
   return (int)StringGetCharacter(s, i);
#else
   return (int)StringGetChar(s, i);
#endif
  }

long AT24C_NowGmt()
  {
   return (long)TimeGMT();
  }

string AT24C_Hex32(const uint v)
  {
   string digits = "0123456789ABCDEF";
   string r = "";
   for(int i = 7; i >= 0; i--)
     {
      uint nib = (v >> (i * 4)) & 0xF;
      r += StringSubstr(digits, (int)nib, 1);
     }
   return r;
  }

//--- Standard CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320). CRC32("123456789") = CBF43926.
uint AT24C_Crc32(const string s)
  {
   uint crc = 0xFFFFFFFF;
   int  n   = StringLen(s);
   for(int i = 0; i < n; i++)
     {
      crc ^= (uint)(AT24C_CharAt(s, i) & 0xFF);
      for(int k = 0; k < 8; k++)
        {
         if((crc & 1) != 0)
            crc = (crc >> 1) ^ 0xEDB88320;
         else
            crc = crc >> 1;
        }
     }
   return ~crc;
  }

//--- Trim spaces/tabs both ends. (MT4's StringTrimLeft/Right do not modify their argument in place,
//--- so the shared code uses its own helper - found by running the self-test inside a real MT4 terminal.)
string AT24C_Trim(const string s)
  {
   int a = 0, b = StringLen(s) - 1;
   while(a <= b && (AT24C_CharAt(s, a) == ' ' || AT24C_CharAt(s, a) == '	'))
      a++;
   while(b >= a && (AT24C_CharAt(s, b) == ' ' || AT24C_CharAt(s, b) == '	'))
      b--;
   return (b < a) ? "" : StringSubstr(s, a, b - a + 1);
  }

//--- Keep only [A-Za-z0-9_-], max 32 chars, never empty.
string AT24C_SanitizeChannel(const string channel)
  {
   string out = "";
   int n = StringLen(channel);
   for(int i = 0; i < n && StringLen(out) < 32; i++)
     {
      int c = AT24C_CharAt(channel, i);
      bool ok = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' || c == '-';
      if(ok)
         out += StringSubstr(channel, i, 1);
     }
   if(StringLen(out) == 0)
      out = "default";
   return out;
  }

string AT24C_FileName(const string channel)
  {
   return "AT24COPY_" + AT24C_SanitizeChannel(channel) + ".txt";
  }

//--- Symbols/tokens must never contain the field or line separators.
string AT24C_CleanToken(const string t)
  {
   string out = "";
   int n = StringLen(t);
   for(int i = 0; i < n; i++)
     {
      int c = AT24C_CharAt(t, i);
      if(c == '|' || c == '\r' || c == '\n' || c < 32)
         continue;
      out += StringSubstr(t, i, 1);
     }
   return out;
  }

string AT24C_Num(const double v, const int digits)
  {
   return DoubleToString(v, digits);
  }

bool AT24C_EndsWithNoCase(const string s, const string suffix)
  {
   int ls = StringLen(s), lx = StringLen(suffix);
   if(lx == 0 || lx > ls)
      return false;
   string tail = StringSubstr(s, ls - lx, lx);
   StringToUpper(tail);
   string suf = suffix;
   StringToUpper(suf);
   return tail == suf;
  }

//+------------------------------------------------------------------+
//| Snapshot build / parse                                           |
//+------------------------------------------------------------------+
string AT24C_BuildSnapshot(const SCopyHeader &h, const SCopyPos &pos[], const int n)
  {
   string body = StringFormat("%s|%d|%s|%s|%I64d|%I64d|%I64d|%s|%s|%d\n",
                              AT24C_PROTO_TAG, AT24C_PROTO_VER, AT24C_SanitizeChannel(h.channel),
                              AT24C_CleanToken(h.platform), h.seq, h.writeGmt, h.login,
                              AT24C_Num(h.equity, 2), AT24C_Num(h.balance, 2), n);
   for(int i = 0; i < n; i++)
     {
      body += StringFormat("P|%I64d|%s|%d|%s|%s|%s|%s|%I64d|%I64d\n",
                           pos[i].id, AT24C_CleanToken(pos[i].symbol), pos[i].side,
                           AT24C_Num(pos[i].volume, 8), AT24C_Num(pos[i].price, 8),
                           AT24C_Num(pos[i].sl, 8), AT24C_Num(pos[i].tp, 8),
                           pos[i].openGmt, pos[i].magic);
     }
   return body + "END|" + AT24C_Hex32(AT24C_Crc32(body)) + "\n";
  }

//--- Returns true only for a complete, CRC-valid, version-1 snapshot. `err` explains a refusal.
bool AT24C_ParseSnapshot(const string text, SCopyHeader &h, SCopyPos &pos[], int &n, string &err)
  {
   n   = 0;
   err = "";
   string lines[];
   int total = StringSplit(text, '\n', lines);
   //--- drop trailing empty lines
   while(total > 0 && StringLen(lines[total - 1]) == 0)
      total--;
   if(total < 2)
     { err = "empty or truncated file"; return false; }

   string endParts[];
   if(StringSplit(lines[total - 1], '|', endParts) != 2 || endParts[0] != "END")
     { err = "no END line (writer mid-write?)"; return false; }

   string body = "";
   for(int i = 0; i < total - 1; i++)
      body += lines[i] + "\n";
   string crc = AT24C_Hex32(AT24C_Crc32(body));
   if(crc != endParts[1])
     { err = "CRC mismatch"; return false; }

   string hp[];
   if(StringSplit(lines[0], '|', hp) != 10)
     { err = "bad header"; return false; }
   if(hp[0] != AT24C_PROTO_TAG)
     { err = "not an AT24 copier file"; return false; }
   if((int)StringToInteger(hp[1]) != AT24C_PROTO_VER)
     { err = "unsupported protocol version " + hp[1]; return false; }

   h.channel  = hp[2];
   h.platform = hp[3];
   h.seq      = StringToInteger(hp[4]);
   h.writeGmt = StringToInteger(hp[5]);
   h.login    = StringToInteger(hp[6]);
   h.equity   = StringToDouble(hp[7]);
   h.balance  = StringToDouble(hp[8]);
   h.count    = (int)StringToInteger(hp[9]);

   if(h.count < 0 || h.count > AT24C_MAX_POS || h.count != total - 2)
     { err = "row count does not match header"; return false; }

   ArrayResize(pos, h.count);
   for(int i = 0; i < h.count; i++)
     {
      string rp[];
      if(StringSplit(lines[i + 1], '|', rp) != 10 || rp[0] != "P")
        { err = "bad position row " + IntegerToString(i); return false; }
      pos[i].id      = StringToInteger(rp[1]);
      pos[i].symbol  = rp[2];
      pos[i].side    = (int)StringToInteger(rp[3]);
      pos[i].volume  = StringToDouble(rp[4]);
      pos[i].price   = StringToDouble(rp[5]);
      pos[i].sl      = StringToDouble(rp[6]);
      pos[i].tp      = StringToDouble(rp[7]);
      pos[i].openGmt = StringToInteger(rp[8]);
      pos[i].magic   = StringToInteger(rp[9]);
      if(pos[i].id <= 0 || StringLen(pos[i].symbol) == 0 || (pos[i].side != 0 && pos[i].side != 1) || pos[i].volume <= 0.0)
        { err = "invalid values in row " + IntegerToString(i); return false; }
     }
   n = h.count;
   return true;
  }

//+------------------------------------------------------------------+
//| File helpers (Common\Files, shared by every terminal on the PC)  |
//+------------------------------------------------------------------+
bool AT24C_WriteTextFile(const string name, const string text)
  {
   int h = FileOpen(name, FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(h == INVALID_HANDLE)
      return false;
   FileWriteString(h, text);
   FileClose(h);
   return true;
  }

//--- false = file missing/unreadable; otherwise `text` holds every non-empty line + "\n".
bool AT24C_ReadTextFile(const string name, string &text)
  {
   text = "";
   int h = FileOpen(name, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ | FILE_SHARE_WRITE);
   if(h == INVALID_HANDLE)
      return false;
   int guard = 0;
   while(!FileIsEnding(h) && guard < AT24C_MAX_POS + 10)
     {
      string line = FileReadString(h);
      guard++;
      if(StringLen(line) == 0)
         continue;
      text += line + "\n";
     }
   FileClose(h);
   return true;
  }

//+------------------------------------------------------------------+
//| Mapping / sizing (pure - unit-testable)                          |
//+------------------------------------------------------------------+
//--- "A=B;C=D" explicit map first (case-insensitive), else strip master suffix + add receiver suffix.
//--- case-insensitive "starts with"
bool AT24C_StartsWithNoCase(const string s, const string prefix)
  {
   if(StringLen(prefix) == 0 || StringLen(s) < StringLen(prefix))
      return false;
   string a = StringSubstr(s, 0, StringLen(prefix)), b = prefix;
   StringToUpper(a);
   StringToUpper(b);
   return a == b;
  }

//--- master symbol minus its broker prefix/suffix = the "core" instrument name
string AT24C_CoreSymbol(const string masterSymbol, const string masterPrefix, const string masterSuffix)
  {
   string core = masterSymbol;
   if(AT24C_StartsWithNoCase(core, masterPrefix))
      core = StringSubstr(core, StringLen(masterPrefix));
   if(AT24C_EndsWithNoCase(core, masterSuffix))
      core = StringSubstr(core, 0, StringLen(core) - StringLen(masterSuffix));
   return core;
  }

string AT24C_MapSymbol(const string masterSymbol, const string masterPrefix, const string masterSuffix,
                       const string recvPrefix, const string recvSuffix, const string symbolMap)
  {
   string up = masterSymbol;
   StringToUpper(up);

   if(StringLen(symbolMap) > 0)
     {
      string pairs[];
      int np = StringSplit(symbolMap, ';', pairs);
      for(int i = 0; i < np; i++)
        {
         string kv[];
         if(StringSplit(pairs[i], '=', kv) != 2)
            continue;
         string k = AT24C_Trim(kv[0]);
         StringToUpper(k);
         string v = AT24C_Trim(kv[1]);
         if(StringLen(k) > 0 && StringLen(v) > 0 && k == up)
            return v;
        }
     }

   return recvPrefix + AT24C_CoreSymbol(masterSymbol, masterPrefix, masterSuffix) + recvSuffix;
  }

//--- Empty list = everything allowed. List holds MASTER symbols, comma separated, with or without suffix.
bool AT24C_SymbolAllowed(const string masterSymbol, const string masterPrefix, const string masterSuffix, const string allowedList)
  {
   if(StringLen(allowedList) == 0)
      return true;
   string raw = masterSymbol;
   StringToUpper(raw);
   string core = AT24C_CoreSymbol(masterSymbol, masterPrefix, masterSuffix);
   StringToUpper(core);

   string items[];
   int ni = StringSplit(allowedList, ',', items);
   for(int i = 0; i < ni; i++)
     {
      string it = AT24C_Trim(items[i]);
      StringToUpper(it);
      if(StringLen(it) > 0 && (it == raw || it == core))
         return true;
     }
   return false;
  }

double AT24C_ScaleVolume(const int mode, const double masterVol, const double multiplier,
                         const double fixedLot, const double masterEquity, const double myEquity)
  {
   if(mode == AT24C_LOT_FIXED)
      return fixedLot;
   if(mode == AT24C_LOT_EQUITY_RATIO)
     {
      if(masterEquity <= 0.0 || myEquity <= 0.0)
         return 0.0;
      return masterVol * (myEquity / masterEquity) * multiplier;
     }
   return masterVol * multiplier;
  }

int AT24C_StepDigits(const double step)
  {
   if(step <= 0.0)
      return 2;
   int d = 0;
   while(d < 8 && MathAbs(step * MathPow(10.0, d) - MathRound(step * MathPow(10.0, d))) > 1e-9)
      d++;
   return d;
  }

//--- Round DOWN to the lot step, clamp to max, 0.0 when below the minimum lot.
double AT24C_FloorToStep(const double vol, const double step, const double vmin, const double vmax)
  {
   if(step <= 0.0 || vol <= 0.0)
      return 0.0;
   double v = MathFloor(vol / step + 1e-9) * step;
   if(vmax > 0.0 && v > vmax)
      v = MathFloor(vmax / step + 1e-9) * step;
   if(v < vmin - 1e-12)
      return 0.0;
   return NormalizeDouble(v, AT24C_StepDigits(step));
  }

//--- Receiver tags every copied position: comment = "AT24C:<masterId>".
string AT24C_MakeComment(const long masterId)
  {
   return AT24C_COMMENT_TAG + IntegerToString(masterId);
  }

bool AT24C_ParseComment(const string comment, long &masterId)
  {
   masterId = 0;
   int tl = StringLen(AT24C_COMMENT_TAG);
   if(StringLen(comment) <= tl || StringSubstr(comment, 0, tl) != AT24C_COMMENT_TAG)
      return false;
   masterId = StringToInteger(StringSubstr(comment, tl));
   return masterId > 0;
  }

#endif // AT24_COPIER_PROTO_MQH
