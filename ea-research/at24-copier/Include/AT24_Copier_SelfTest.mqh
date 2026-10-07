//+------------------------------------------------------------------+
//| AT24_Copier_SelfTest.mqh                                         |
//| Runs inside a real terminal (MT4 or MT5) and checks the shared   |
//| protocol: CRC vector, snapshot round-trip, tamper/partial-write  |
//| detection, symbol mapping, lot math, comment tags, file I/O.     |
//| Result is returned as text; the wrapper scripts print it and     |
//| also write it to Common\Files so it can be read from outside.    |
//+------------------------------------------------------------------+
#ifndef AT24_COPIER_SELFTEST_MQH
#define AT24_COPIER_SELFTEST_MQH

#include "AT24_Copier_Proto.mqh"

int    g_stPass = 0;
int    g_stFail = 0;
string g_stOut  = "";

void ST_Check(const string name, const bool ok)
  {
   if(ok)
      g_stPass++;
   else
      g_stFail++;
   g_stOut += (ok ? "PASS  " : "FAIL  ") + name + "\n";
  }

bool ST_Near(const double a, const double b)
  {
   return MathAbs(a - b) < 1e-9;
  }

string ST_Platform()
  {
#ifdef __MQL5__
   return "MT5";
#else
   return "MT4";
#endif
  }

int AT24C_RunSelfTest(string &report)
  {
   g_stPass = 0;
   g_stFail = 0;
   g_stOut  = "AT24 Copier protocol self-test (" + ST_Platform() + ") v" + AT24C_VERSION + "\n";

   //--- 1. CRC-32 standard check value
   ST_Check("crc32('123456789') == CBF43926", AT24C_Hex32(AT24C_Crc32("123456789")) == "CBF43926");
   ST_Check("crc32('') == 00000000", AT24C_Hex32(AT24C_Crc32("")) == "00000000");

   //--- 2. snapshot round-trip
   SCopyHeader h;
   h.channel  = "my chan!";            // sanitised to "mychan"
   h.platform = ST_Platform();
   h.seq      = 41;
   h.writeGmt = 1790000000;
   h.login    = 987654321;
   h.equity   = 10234.56;
   h.balance  = 10000.00;
   h.count    = 3;
   SCopyPos src[];
   ArrayResize(src, 3);
   src[0].id = 111; src[0].symbol = "XAUUSD"; src[0].side = 0; src[0].volume = 0.05; src[0].price = 2650.12; src[0].sl = 2640.0; src[0].tp = 2670.5; src[0].openGmt = 1789999990; src[0].magic = 7;
   src[1].id = 222; src[1].symbol = "EURUSD.m"; src[1].side = 1; src[1].volume = 1.25; src[1].price = 1.08765; src[1].sl = 0.0; src[1].tp = 0.0; src[1].openGmt = 1789999991; src[1].magic = 0;
   src[2].id = 9223372036854775; src[2].symbol = "BTC|USD"; src[2].side = 0; src[2].volume = 0.01; src[2].price = 65000.5; src[2].sl = 64000.0; src[2].tp = 0.0; src[2].openGmt = 1789999999; src[2].magic = 123456789;
   string snap = AT24C_BuildSnapshot(h, src, 3);
   SCopyHeader  oh;
   SCopyPos     op[];
   int          on = 0;
   string       err;
   bool parsed = AT24C_ParseSnapshot(snap, oh, op, on, err);
   ST_Check("round-trip parses (" + err + ")", parsed);
   ST_Check("header channel sanitised", parsed && oh.channel == "mychan");
   ST_Check("header fields", parsed && oh.seq == 41 && oh.writeGmt == 1790000000 && oh.login == 987654321 && ST_Near(oh.equity, 10234.56) && ST_Near(oh.balance, 10000.0) && oh.count == 3 && oh.platform == ST_Platform());
   ST_Check("row 0 fields", parsed && on == 3 && op[0].id == 111 && op[0].symbol == "XAUUSD" && op[0].side == 0 && ST_Near(op[0].volume, 0.05) && ST_Near(op[0].price, 2650.12) && ST_Near(op[0].sl, 2640.0) && ST_Near(op[0].tp, 2670.5) && op[0].openGmt == 1789999990 && op[0].magic == 7);
   ST_Check("row 1 sell, no stops", parsed && on == 3 && op[1].side == 1 && ST_Near(op[1].sl, 0.0) && ST_Near(op[1].tp, 0.0) && ST_Near(op[1].volume, 1.25));
   ST_Check("row 2 big id + separator stripped from symbol", parsed && on == 3 && op[2].id == 9223372036854775 && op[2].symbol == "BTCUSD" && op[2].magic == 123456789);

   //--- 3. tamper / partial write detection
   string t1 = snap;
   StringReplace(t1, "XAUUSD", "XAUUSX");
   ST_Check("changed symbol -> CRC mismatch", !AT24C_ParseSnapshot(t1, oh, op, on, err) && err == "CRC mismatch");
   string t2 = StringSubstr(snap, 0, StringLen(snap) - 14);
   ST_Check("truncated file -> refused", !AT24C_ParseSnapshot(t2, oh, op, on, err));
   int endPos = StringFind(snap, "END|");
   string t3 = StringSubstr(snap, 0, endPos);
   ST_Check("missing END line -> refused", !AT24C_ParseSnapshot(t3, oh, op, on, err) && StringFind(err, "END") >= 0);
   ST_Check("empty text -> refused", !AT24C_ParseSnapshot("", oh, op, on, err));
   ST_Check("garbage -> refused", !AT24C_ParseSnapshot("hello\nworld\n", oh, op, on, err));

   //--- row count lie (CRC recomputed so only the count check can catch it)
   string body = StringFormat("%s|%d|c|%s|1|1790000000|1|100.00|100.00|5\nP|1|EURUSD|0|0.1|1.1|0|0|1790000000|0\n", AT24C_PROTO_TAG, AT24C_PROTO_VER, ST_Platform());
   string lie = body + "END|" + AT24C_Hex32(AT24C_Crc32(body)) + "\n";
   ST_Check("header count != rows -> refused", !AT24C_ParseSnapshot(lie, oh, op, on, err) && StringFind(err, "count") >= 0);
   string body2 = StringFormat("%s|%d|c|%s|1|1790000000|1|100.00|100.00|0\n", AT24C_PROTO_TAG, 2, ST_Platform());
   string ver2 = body2 + "END|" + AT24C_Hex32(AT24C_Crc32(body2)) + "\n";
   ST_Check("unknown protocol version -> refused", !AT24C_ParseSnapshot(ver2, oh, op, on, err) && StringFind(err, "version") >= 0);
   string body3 = StringFormat("%s|%d|c|%s|7|1790000000|1|100.00|100.00|0\n", AT24C_PROTO_TAG, AT24C_PROTO_VER, ST_Platform());
   string empty = body3 + "END|" + AT24C_Hex32(AT24C_Crc32(body3)) + "\n";
   ST_Check("valid EMPTY book parses (count 0)", AT24C_ParseSnapshot(empty, oh, op, on, err) && on == 0 && oh.seq == 7);
   string body4 = StringFormat("%s|%d|c|%s|1|1790000000|1|100.00|100.00|1\nP|5|EURUSD|3|0.1|1.1|0|0|1790000000|0\n", AT24C_PROTO_TAG, AT24C_PROTO_VER, ST_Platform());
   string badSide = body4 + "END|" + AT24C_Hex32(AT24C_Crc32(body4)) + "\n";
   ST_Check("invalid side value -> refused", !AT24C_ParseSnapshot(badSide, oh, op, on, err));

   //--- 4. symbol mapping + filters
   ST_Check("map strips master suffix, adds mine", AT24C_MapSymbol("XAUUSD.m", "", ".m", "", "+", "") == "XAUUSD+");
   ST_Check("map no prefix/suffix", AT24C_MapSymbol("EURUSD", "", "", "", "", "") == "EURUSD");
   ST_Check("map suffix is case-insensitive", AT24C_MapSymbol("EURUSD.M", "", ".m", "", "", "") == "EURUSD");
   ST_Check("map strips master prefix, adds mine", AT24C_MapSymbol("m.XAUUSD", "m.", "", "#", "", "") == "#XAUUSD");
   ST_Check("map prefix + suffix both ways", AT24C_MapSymbol("pro.EURUSD.sd", "pro.", ".sd", "FX_", "c", "") == "FX_EURUSDc");
   ST_Check("map prefix is case-insensitive", AT24C_MapSymbol("M.EURUSD", "m.", "", "", "", "") == "EURUSD");
   ST_Check("map prefix not present = unchanged core", AT24C_MapSymbol("EURUSD", "m.", "", "", "", "") == "EURUSD");
   ST_Check("explicit map wins", AT24C_MapSymbol("XAUUSD", "", "", "", "+", "US30=DJ30; xauusd = GOLD") == "GOLD");
   ST_Check("explicit map miss falls back to prefix/suffix rule", AT24C_MapSymbol("EURUSD", "", "", "", "c", "XAUUSD=GOLD") == "EURUSDc");
   ST_Check("allowed: empty list = all", AT24C_SymbolAllowed("ANY", "", "", ""));
   ST_Check("allowed: prefix+suffix aware", AT24C_SymbolAllowed("m.XAUUSD.x", "m.", ".x", "xauusd") && !AT24C_SymbolAllowed("m.GBPUSD.x", "m.", ".x", "xauusd"));
   ST_Check("allowed: exact + suffix-insensitive", AT24C_SymbolAllowed("XAUUSD.m", "", ".m", "eurusd, XAUUSD") && !AT24C_SymbolAllowed("GBPUSD.m", "", ".m", "eurusd, XAUUSD"));

   //--- 5. lot maths
   ST_Check("multiplier", ST_Near(AT24C_ScaleVolume(AT24C_LOT_MULTIPLIER, 0.10, 0.5, 0.0, 0, 0), 0.05));
   ST_Check("fixed lot ignores master volume", ST_Near(AT24C_ScaleVolume(AT24C_LOT_FIXED, 3.0, 9.0, 0.02, 0, 0), 0.02));
   ST_Check("equity ratio", ST_Near(AT24C_ScaleVolume(AT24C_LOT_EQUITY_RATIO, 1.0, 1.0, 0.0, 10000.0, 2500.0), 0.25));
   ST_Check("equity ratio with 0 master equity -> 0", ST_Near(AT24C_ScaleVolume(AT24C_LOT_EQUITY_RATIO, 1.0, 1.0, 0.0, 0.0, 2500.0), 0.0));
   ST_Check("floor to step rounds DOWN", ST_Near(AT24C_FloorToStep(0.037, 0.01, 0.01, 100.0), 0.03));
   ST_Check("below min lot -> 0", ST_Near(AT24C_FloorToStep(0.004, 0.01, 0.01, 100.0), 0.0));
   ST_Check("clamped to max lot", ST_Near(AT24C_FloorToStep(250.0, 0.01, 0.01, 100.0), 100.0));
   ST_Check("step 0.1 / min 0.1", ST_Near(AT24C_FloorToStep(0.29, 0.1, 0.1, 50.0), 0.2));
   ST_Check("step digits", AT24C_StepDigits(0.01) == 2 && AT24C_StepDigits(0.1) == 1 && AT24C_StepDigits(1.0) == 0 && AT24C_StepDigits(0.001) == 3);

   //--- 6. comment tag
   long mid = 0;
   ST_Check("comment make/parse", AT24C_ParseComment(AT24C_MakeComment(123456789012), mid) && mid == 123456789012);
   ST_Check("foreign comment rejected", !AT24C_ParseComment("my manual trade", mid) && !AT24C_ParseComment("AT24C:", mid) && !AT24C_ParseComment("AT24C:abc", mid));
   ST_Check("max-size id fits MT4's 31-char comment", StringLen(AT24C_MakeComment(9223372036854775807)) <= 31);

   //--- 7. channel / file name
   ST_Check("channel sanitised", AT24C_SanitizeChannel("a b/c\\d..e") == "abcde" && AT24C_SanitizeChannel("###") == "default");
   ST_Check("file name", AT24C_FileName("Gold-1") == "AT24COPY_Gold-1.txt");

   //--- 8. real file I/O through the common folder
   string fname = "AT24COPY_SELFTEST_TMP.txt";
   bool w = AT24C_WriteTextFile(fname, snap);
   string back = "";
   bool r = AT24C_ReadTextFile(fname, back);
   ST_Check("file write+read", w && r);
   ST_Check("file content parses identically", r && AT24C_ParseSnapshot(back, oh, op, on, err) && on == 3 && op[1].symbol == "EURUSD.m");
   FileDelete(fname, FILE_COMMON);
   string none = "x";
   ST_Check("missing file -> read returns false", !AT24C_ReadTextFile("AT24COPY_DOES_NOT_EXIST_" + IntegerToString(GetTickCount()) + ".txt", none));

   g_stOut += StringFormat("SUMMARY  pass=%d fail=%d\n", g_stPass, g_stFail);
   report = g_stOut;
   return g_stFail;
  }

#endif // AT24_COPIER_SELFTEST_MQH
