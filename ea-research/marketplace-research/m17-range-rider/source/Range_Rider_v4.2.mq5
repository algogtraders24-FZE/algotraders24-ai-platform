//+------------------------------------------------------------------+
//|                                          Range_Rider_v4.2.mq5    |
//|                 Rider A/B/C/D + on-chart live dashboard (v4.2)   |
//+------------------------------------------------------------------+
#property copyright "Range Rider EA"
#property version   "4.20"
#property description "Range Rider v4.2 - Rider A/B/C/D + live dashboard (hedging accounts only)"

#include <Trade\Trade.mqh>
#include <Trade\SymbolInfo.mqh>
#include <Trade\PositionInfo.mqh>
#include <Canvas\Canvas.mqh>

//+------------------------------------------------------------------+
enum ENUM_DIRECTION { DIR_BUY_SELL, DIR_BUY_ONLY, DIR_SELL_ONLY };
enum ENUM_LOT_MODE  { LOT_FIXED, LOT_RISK, LOT_BALANCE };
enum ENUM_SLIPPAGE  { SLIP_LOW, SLIP_MEDIUM, SLIP_HIGH };
enum ENUM_DASHBOARD { DASH_BIG, DASH_SMALL, DASH_DISABLED };
enum ENUM_TRAIL_MODE { TRAIL_STANDARD, TRAIL_CUSTOM };
enum ENUM_NEWS_WEEK  { WEEK_OFF, WEEK_LOW, WEEK_HIGH };

input group "=== NEWS FILTER ==="
input bool             InpEnableNewsFilter    = false;  // needs Allow WebRequest for the URL below; inactive in Strategy Tester
input int              InpNewsMinutesBefore   = 30;
input int              InpNewsMinutesAfter    = 30;
input ENUM_NEWS_WEEK   InpNewsWeekRisk        = WEEK_OFF;

input group "=== NEWS FILTER - EVENTS ==="
input bool             InpNewsFOMC            = true;
input bool             InpNewsCPI             = true;
input bool             InpNewsNFPJobs         = true;
input bool             InpNewsPCE             = true;
input bool             InpNewsPPI             = false;
input bool             InpNewsGDP             = false;
input bool             InpNewsRetailSales     = false;
input bool             InpNewsISM             = false;

input group "=== NEWS FILTER - WEBREQUEST ==="
input string           InpWebRequestSetup     = "MT5: Tools > Options > Expert Advisors > Allow WebRequest";
input string           InpWebRequestURL       = "https://nfs.faireconomy.media";

input group "=== SYSTEM ==="
input int              InpMagicGhostA         = 2101;
input int              InpMagicGhostB         = 2102;
input int              InpMagicGhostC         = 2103;
input int              InpMagicGhostD         = 2104;
input double           InpUnitOverride        = 0.0;    // price distance of 1 input unit (0 = auto: pip = 10 points on 3/5-digit symbols, else 1 point)

input group "=== PROTECTION ==="
input int              InpMaxSpreadPoints     = 0;      // 0 = off. Block new entries if spread above this (points)
input double           InpMaxDailyLossPct     = 0.0;    // 0 = off. Block new entries after equity falls this % from the day's start

input group "=== RIDER A (H1 Breakout) ==="
input bool             InpEnableGhostA        = true;
input ENUM_DIRECTION   InpDirectionGhostA     = DIR_BUY_SELL;
input ENUM_LOT_MODE    InpLotModeGhostA       = LOT_BALANCE;
input double           InpFixedLotGhostA      = 0.01;
input double           InpRiskGhostA          = 0.25;
input double           InpBalanceRefGhostA    = 100.0;
input ENUM_TRAIL_MODE  InpTrailModeGhostA     = TRAIL_STANDARD;  // STANDARD = fixed-distance trail; CUSTOM = breakeven first, then trail
input double           InpStopLossGhostA      = 500.0;
input double           InpTakeProfitGhostA    = 1500.0;
input double           InpTrailStartGhostA    = 100.0;
input double           InpTrailDistGhostA     = 250.0;
input double           InpTrailStepGhostA     = 50.0;
input ENUM_SLIPPAGE    InpSlippageGhostA      = SLIP_MEDIUM;

input group "=== RIDER B (M15 Momentum) ==="
input bool             InpEnableGhostB        = true;
input ENUM_DIRECTION   InpDirectionGhostB     = DIR_BUY_SELL;
input ENUM_LOT_MODE    InpLotModeGhostB       = LOT_BALANCE;
input double           InpFixedLotGhostB      = 0.01;
input double           InpRiskGhostB          = 0.25;
input double           InpBalanceRefGhostB    = 100.0;
input ENUM_TRAIL_MODE  InpTrailModeGhostB     = TRAIL_STANDARD;  // STANDARD = fixed-distance trail; CUSTOM = breakeven first, then trail
input double           InpStopLossGhostB      = 500.0;
input double           InpTakeProfitGhostB    = 1500.0;
input double           InpTrailStartGhostB    = 100.0;
input double           InpTrailDistGhostB     = 250.0;
input double           InpTrailStepGhostB     = 50.0;
input ENUM_SLIPPAGE    InpSlippageGhostB      = SLIP_MEDIUM;
input bool             InpGhostBCrossOnly     = false;  // true = enter only on a fresh EMA20/EMA50 cross (default false = v4.0 behaviour)

input group "=== RIDER C (Session Breakout) ==="
input bool             InpEnableGhostC        = true;
input ENUM_DIRECTION   InpDirectionGhostC     = DIR_BUY_SELL;
input ENUM_LOT_MODE    InpLotModeGhostC       = LOT_BALANCE;
input double           InpFixedLotGhostC      = 0.01;
input double           InpRiskGhostC          = 0.25;
input double           InpBalanceRefGhostC    = 100.0;
input ENUM_TRAIL_MODE  InpTrailModeGhostC     = TRAIL_STANDARD;  // STANDARD = fixed-distance trail; CUSTOM = breakeven first, then trail
input double           InpStopLossGhostC      = 500.0;
input double           InpTakeProfitGhostC    = 1500.0;
input double           InpTrailStartGhostC    = 100.0;
input double           InpTrailDistGhostC     = 250.0;
input double           InpTrailStepGhostC     = 50.0;
input ENUM_SLIPPAGE    InpSlippageGhostC      = SLIP_MEDIUM;
input int              InpSessionHour1C       = 8;      // server time hour (London open on your broker)
input int              InpSessionHour2C       = 13;     // server time hour (New York open on your broker)
input double           InpOrderLifeHoursC     = 4.0;    // pending orders expire after this many hours

input group "=== RIDER D (Volatility Expansion) ==="
input bool             InpEnableGhostD        = true;
input ENUM_DIRECTION   InpDirectionGhostD     = DIR_BUY_SELL;
input ENUM_LOT_MODE    InpLotModeGhostD       = LOT_BALANCE;
input double           InpFixedLotGhostD      = 0.01;
input double           InpRiskGhostD          = 0.25;
input double           InpBalanceRefGhostD    = 100.0;
input ENUM_TRAIL_MODE  InpTrailModeGhostD     = TRAIL_STANDARD;  // STANDARD = fixed-distance trail; CUSTOM = breakeven first, then trail
input double           InpStopLossGhostD      = 500.0;
input double           InpTakeProfitGhostD    = 1500.0;
input double           InpTrailStartGhostD    = 100.0;
input double           InpTrailDistGhostD     = 250.0;
input double           InpTrailStepGhostD     = 50.0;
input ENUM_SLIPPAGE    InpSlippageGhostD      = SLIP_MEDIUM;
input int              InpATRPeriodGhostD     = 14;
input double           InpATRMultiplierGhostD = 1.5;
input int              InpConsolidationBars   = 10;
input double           InpOrderLifeHoursD     = 3.0;    // pending orders expire after this many hours

input group "=== DASHBOARD ==="
input ENUM_DASHBOARD   InpDashboardMode       = DASH_BIG;
input bool             InpDashInTester        = false;  // false = no dashboard in Strategy Tester (faster backtests)
input int              InpDashX               = 10;
input int              InpDashY               = 30;
input double           InpDashDDScale         = 30.0;   // % drawdown that fills the whole meter

input group "=== DEBUG / LOGGING ==="
input bool             InpDebugMode           = true;

//+------------------------------------------------------------------+
#define GH_A 0
#define GH_B 1
#define GH_C 2
#define GH_D 3

struct GhostCfg
{
   bool           on;
   int            magic;
   ENUM_DIRECTION dir;
   ENUM_LOT_MODE  lotMode;
   double         fixedLot, risk, balRef;
   double         sl, tp, trStart, trDist, trStep;   // input units
   ENUM_TRAIL_MODE trMode;
   int            slipPts;
   string         tag;
};

CTrade         g_trade;
CSymbolInfo    g_sym;
CPositionInfo  g_pos;
GhostCfg       rd[4];

double         g_unit = 0.0;                 // price distance of one input unit
datetime       g_lastBarA = 0, g_lastBarD = 0, g_lastM15B = 0;
datetime       g_lastSessionC = 0;
datetime       g_dayStart = 0;
double         g_dayStartEq = 0.0;
int            g_hEmaFast = INVALID_HANDLE, g_hEmaSlow = INVALID_HANDLE, g_hRsi = INVALID_HANDLE, g_hAtr = INVALID_HANDLE;

//+------------------------------------------------------------------+
string g_lastMsg = "-";

void Note(const string s) { g_lastMsg = TimeToString(TimeCurrent(), TIME_MINUTES) + " " + s; }

void Log(const string s)
{
   if(StringFind(s, "skipped") >= 0 || StringFind(s, "failed") >= 0 || StringFind(s, "limit") >= 0 || StringFind(s, "margin") >= 0) Note(s);
   if(InpDebugMode) Print(s);
}

int SlipPoints(ENUM_SLIPPAGE m)
{
   switch(m) {
      case SLIP_LOW:  return 20;
      case SLIP_HIGH: return 100;
      default:        return 50;
   }
}

void LoadCfg(int i, bool on, int magic, ENUM_DIRECTION dir, ENUM_LOT_MODE lm, double fl, double rk, double br,
             double sl, double tp, double ts, double td, double tst, ENUM_SLIPPAGE slip, string tag)
{
   rd[i].on = on; rd[i].magic = magic; rd[i].dir = dir; rd[i].lotMode = lm;
   rd[i].fixedLot = fl; rd[i].risk = rk; rd[i].balRef = br;
   rd[i].sl = sl; rd[i].tp = tp; rd[i].trStart = ts; rd[i].trDist = td; rd[i].trStep = tst;
   rd[i].slipPts = SlipPoints(slip); rd[i].tag = tag;
}

int LotDigits(double step)
{
   int d = 0; double s = step;
   while(d < 8 && MathAbs(s - MathRound(s)) > 1e-9) { s *= 10.0; d++; }
   return d;
}

double MinDistance()   // broker minimum distance for pending price / SL / TP
{
   long stops  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long freeze = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   return (double)MathMax(stops, freeze) * _Point;
}

//+------------------------------------------------------------------+
//| Lot size. Returns 0 when the trade must be skipped.              |
//+------------------------------------------------------------------+
double CalcLot(int i)
{
   double lot = rd[i].fixedLot;
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);

   if(rd[i].lotMode == LOT_RISK) {
      double tv = g_sym.TickValue(), ts = g_sym.TickSize();
      double slDist = rd[i].sl * g_unit;
      if(tv <= 0 || ts <= 0 || slDist <= 0) return 0.0;
      lot = bal * (rd[i].risk / 100.0) / ((slDist / ts) * tv);
   }
   else if(rd[i].lotMode == LOT_BALANCE) {
      if(rd[i].balRef <= 0) return 0.0;
      lot = rd[i].fixedLot * bal / rd[i].balRef;
   }

   double minLot = g_sym.LotsMin(), maxLot = g_sym.LotsMax(), step = g_sym.LotsStep();
   if(step > 0) lot = MathFloor(lot / step + 1e-9) * step;
   if(lot < minLot) {
      if(rd[i].lotMode == LOT_RISK) { Log(rd[i].tag + ": risk lot below broker minimum - trade skipped"); return 0.0; }
      lot = minLot;
   }
   lot = MathMin(maxLot, lot);
   return NormalizeDouble(lot, LotDigits(step));
}

bool MarginOK(ENUM_ORDER_TYPE type, double lot, double price)
{
   double need = 0.0;
   if(!OrderCalcMargin(type, _Symbol, lot, price, need)) return true;   // cannot compute -> let the broker decide
   if(need > AccountInfoDouble(ACCOUNT_MARGIN_FREE)) { Log("Not enough free margin for lot " + DoubleToString(lot, 2)); return false; }
   return true;
}

void UpdateDay()
{
   datetime d = iTime(_Symbol, PERIOD_D1, 0);
   if(d != g_dayStart && d > 0) { g_dayStart = d; g_dayStartEq = AccountInfoDouble(ACCOUNT_EQUITY); }
}

//+------------------------------------------------------------------+
//| NEWS FILTER - FairEconomy weekly calendar via WebRequest         |
//| Needs: Tools > Options > Expert Advisors > Allow WebRequest and  |
//| add the InpWebRequestURL address. Not available in the Strategy  |
//| Tester (filter is inactive in backtests).                        |
//| InpNewsWeekRisk: WEEK_OFF = only the minutes before/after;       |
//|   WEEK_LOW = block the whole day of a selected event;            |
//|   WEEK_HIGH = block the whole week of a selected event.          |
//+------------------------------------------------------------------+
struct NewsEv { datetime t; string title; };
NewsEv   g_news[200];
int      g_newsN = 0;
datetime g_newsFetchedAt = 0, g_newsNextTry = 0;
bool     g_newsBlocked = false;
bool     g_newsTesterWarned = false;

string JField(const string obj, const string key)
{
   string pat = "\"" + key + "\":";
   int p = StringFind(obj, pat);
   if(p < 0) return "";
   p += StringLen(pat);
   int n = StringLen(obj);
   while(p < n && StringGetCharacter(obj, p) == ' ') p++;
   if(p >= n) return "";
   if(StringGetCharacter(obj, p) == '"') {
      int e = StringFind(obj, "\"", p + 1);
      if(e < 0) return "";
      return StringSubstr(obj, p + 1, e - p - 1);
   }
   int e2 = p;
   while(e2 < n && StringGetCharacter(obj, e2) != ',' && StringGetCharacter(obj, e2) != '}') e2++;
   return StringSubstr(obj, p, e2 - p);
}

datetime ParseIsoUtc(const string s)
{
   if(StringLen(s) < 19) return 0;
   string d = StringSubstr(s, 0, 10);
   StringReplace(d, "-", ".");
   datetime t = StringToTime(d + " " + StringSubstr(s, 11, 8));
   long off = 0;
   if(StringLen(s) >= 25) {
      int sign = (StringGetCharacter(s, 19) == '-') ? -1 : 1;
      off = sign * ((long)StringToInteger(StringSubstr(s, 20, 2)) * 3600 + (long)StringToInteger(StringSubstr(s, 23, 2)) * 60);
   }
   return (datetime)((long)t - off);
}

long ServerOffsetSec() { return (long)MathRound((double)(TimeTradeServer() - TimeGMT()) / 900.0) * 900; }

bool NewsTitleWanted(string t)
{
   StringToUpper(t);
   if(InpNewsFOMC && (StringFind(t, "FOMC") >= 0 || StringFind(t, "FEDERAL FUNDS") >= 0)) return true;
   if(InpNewsCPI && StringFind(t, "CPI") >= 0) return true;
   if(InpNewsNFPJobs && (StringFind(t, "NON-FARM") >= 0 || StringFind(t, "NONFARM") >= 0 || StringFind(t, "UNEMPLOYMENT RATE") >= 0 || StringFind(t, "ADP") >= 0)) return true;
   if(InpNewsPCE && StringFind(t, "PCE") >= 0) return true;
   if(InpNewsPPI && StringFind(t, "PPI") >= 0) return true;
   if(InpNewsGDP && StringFind(t, "GDP") >= 0) return true;
   if(InpNewsRetailSales && StringFind(t, "RETAIL SALES") >= 0) return true;
   if(InpNewsISM && StringFind(t, "ISM") >= 0) return true;
   return false;
}

bool News_Fetch()
{
   string url = InpWebRequestURL;
   if(StringLen(url) > 0 && StringSubstr(url, StringLen(url) - 1) == "/") url = StringSubstr(url, 0, StringLen(url) - 1);
   url += "/ff_calendar_thisweek.json";

   char post[], res[];
   string rhdr;
   ResetLastError();
   int code = WebRequest("GET", url, "User-Agent: Mozilla/5.0\r\n", 8000, post, res, rhdr);
   if(code == -1) {
      Note("news: allow WebRequest URL in options");
      Print("News filter: WebRequest failed (err ", GetLastError(), "). Add ", InpWebRequestURL, " in Tools > Options > Expert Advisors > Allow WebRequest.");
      return false;
   }
   if(code != 200) { Note("news feed HTTP " + (string)code); Print("News filter: feed returned HTTP ", code); return false; }

   string body = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   string c1 = SymbolInfoString(_Symbol, SYMBOL_CURRENCY_BASE), c2 = SymbolInfoString(_Symbol, SYMBOL_CURRENCY_PROFIT);
   int cnt = 0, pos = 0;
   while(cnt < 200) {
      int s = StringFind(body, "{", pos);
      if(s < 0) break;
      int e = StringFind(body, "}", s);
      if(e < 0) break;
      string obj = StringSubstr(body, s, e - s + 1);
      pos = e + 1;
      string country = JField(obj, "country"), title = JField(obj, "title");
      if(country != c1 && country != c2) continue;
      if(!NewsTitleWanted(title)) continue;
      datetime tu = ParseIsoUtc(JField(obj, "date"));
      if(tu == 0) continue;
      g_news[cnt].t = tu;
      g_news[cnt].title = country + " " + title;
      cnt++;
   }
   g_newsN = cnt;
   Print("News filter: ", cnt, " relevant events loaded for ", _Symbol, " (", c1, "/", c2, ")");
   return true;
}

bool News_Compute(string &why)
{
   datetime now = TimeTradeServer();
   long so = ServerOffsetSec();
   long before = (long)InpNewsMinutesBefore * 60, after = (long)InpNewsMinutesAfter * 60;
   for(int i = 0; i < g_newsN; i++) {
      long ts = (long)g_news[i].t + so;                       // event time in broker server time
      if((long)now >= ts - before && (long)now <= ts + after) { why = g_news[i].title; return true; }
      if(InpNewsWeekRisk == WEEK_LOW && (long)now / 86400 == ts / 86400) { why = g_news[i].title + " (event day)"; return true; }
      if(InpNewsWeekRisk == WEEK_HIGH) {
         long wn = ((long)now / 86400 + 3) / 7, we = (ts / 86400 + 3) / 7;   // 1970-01-01 is a Thursday -> +3 aligns weeks to Monday
         if(wn == we) { why = g_news[i].title + " (event week)"; return true; }
      }
   }
   return false;
}

bool EntryAllowed()
{
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED)) return false;
   if(SymbolInfoInteger(_Symbol, SYMBOL_TRADE_MODE) != SYMBOL_TRADE_MODE_FULL) return false;
   if(g_newsBlocked) { Log("News window - entry skipped"); return false; }
   if(InpMaxSpreadPoints > 0 && SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpreadPoints) { Log("Spread too wide - entry skipped"); return false; }
   if(InpMaxDailyLossPct > 0 && g_dayStartEq > 0 &&
      AccountInfoDouble(ACCOUNT_EQUITY) < g_dayStartEq * (1.0 - InpMaxDailyLossPct / 100.0)) { Log("Daily loss limit reached - entry skipped"); return false; }
   return true;
}

bool HasOpenPosition(int magic)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(g_pos.SelectByIndex(i) && g_pos.Symbol() == _Symbol && g_pos.Magic() == magic) return true;
   return false;
}

bool HasPendingOrder(int magic)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--) {
      ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && OrderGetInteger(ORDER_MAGIC) == magic) return true;
   }
   return false;
}

// maxAgeSec = 0 -> delete every pending order of this magic; otherwise only those older than maxAgeSec
void CancelPending(int magic, long maxAgeSec = 0)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--) {
      ulong t = OrderGetTicket(i);
      if(t == 0 || OrderGetString(ORDER_SYMBOL) != _Symbol || OrderGetInteger(ORDER_MAGIC) != magic) continue;
      if(maxAgeSec > 0 && (TimeCurrent() - (datetime)OrderGetInteger(ORDER_TIME_SETUP)) <= maxAgeSec) continue;
      if(!g_trade.OrderDelete(t)) Log("OrderDelete failed #" + (string)t + " rc=" + (string)g_trade.ResultRetcode());
   }
}

// Stateless OCO: once a ghost has an open position, remove its leftover pending orders (survives EA restarts)
void CancelOppositeIfFilled(int i)
{
   if(OrdersTotal() == 0) return;
   if(HasOpenPosition(rd[i].magic) && HasPendingOrder(rd[i].magic)) {
      CancelPending(rd[i].magic);
      Log(rd[i].tag + ": position filled - opposite pending cancelled");
   }
}

//+------------------------------------------------------------------+
bool PlaceStop(int i, bool buy, double price, double lot, double lifeHours)
{
   if(lot <= 0) return false;
   double slD = rd[i].sl * g_unit, tpD = rd[i].tp * g_unit, minD = MinDistance();
   double ask = g_sym.Ask(), bid = g_sym.Bid();
   price = NormalizeDouble(price, _Digits);

   if(buy  && price <= ask + minD) { Log(rd[i].tag + ": buy stop price not above market - skipped"); return false; }
   if(!buy && price >= bid - minD) { Log(rd[i].tag + ": sell stop price not below market - skipped"); return false; }
   if(slD <= 0 || slD < minD || (tpD > 0 && tpD < minD)) { Log(rd[i].tag + ": SL/TP closer than broker stops level - skipped"); return false; }

   double sl = NormalizeDouble(buy ? price - slD : price + slD, _Digits);
   double tp = tpD > 0 ? NormalizeDouble(buy ? price + tpD : price - tpD, _Digits) : 0.0;
   if(!MarginOK(buy ? ORDER_TYPE_BUY_STOP : ORDER_TYPE_SELL_STOP, lot, price)) return false;

   ENUM_ORDER_TYPE_TIME tt = ORDER_TIME_GTC; datetime exp = 0;
   if(lifeHours > 0 && (SymbolInfoInteger(_Symbol, SYMBOL_EXPIRATION_MODE) & SYMBOL_EXPIRATION_SPECIFIED) != 0) {
      tt = ORDER_TIME_SPECIFIED; exp = TimeCurrent() + (datetime)(lifeHours * 3600.0);
   }

   g_trade.SetExpertMagicNumber(rd[i].magic);
   bool ok = buy ? g_trade.BuyStop(lot, price, _Symbol, sl, tp, tt, exp, rd[i].tag)
                 : g_trade.SellStop(lot, price, _Symbol, sl, tp, tt, exp, rd[i].tag);
   if(ok) Log(rd[i].tag + (buy ? " BUY STOP @ " : " SELL STOP @ ") + DoubleToString(price, _Digits) + " lot " + DoubleToString(lot, 2));
   else {
      Note(rd[i].tag + " order failed rc=" + (string)g_trade.ResultRetcode());
      Print(rd[i].tag, " order FAILED rc=", g_trade.ResultRetcode(), " ", g_trade.ResultRetcodeDescription());
   }
   return ok;
}

void PlaceBreakoutPair(int i, double hi, double lo, double buffer, double lifeHours)
{
   double lot = CalcLot(i);
   if(lot <= 0) return;
   if(rd[i].dir != DIR_SELL_ONLY) PlaceStop(i, true,  hi + buffer, lot, lifeHours);
   if(rd[i].dir != DIR_BUY_ONLY)  PlaceStop(i, false, lo - buffer, lot, lifeHours);
}

//+------------------------------------------------------------------+
void GhostA_Entry()
{
   double hi = iHigh(_Symbol, PERIOD_H1, 1), lo = iLow(_Symbol, PERIOD_H1, 1);
   if(hi <= 0 || lo <= 0) return;
   PlaceBreakoutPair(GH_A, hi, lo, 2.0 * g_unit, 1.0);   // same 2-unit buffer as v4.0
}

//+------------------------------------------------------------------+
void GhostB_Entry()
{
   if(HasOpenPosition(rd[GH_B].magic)) return;
   datetime m15 = iTime(_Symbol, PERIOD_M15, 0);
   if(m15 == g_lastM15B || m15 == 0) return;

   double emaF[], emaS[], rsi[];
   ArraySetAsSeries(emaF, true); ArraySetAsSeries(emaS, true); ArraySetAsSeries(rsi, true);
   if(CopyBuffer(g_hEmaFast, 0, 0, 3, emaF) < 3) return;
   if(CopyBuffer(g_hEmaSlow, 0, 0, 3, emaS) < 3) return;
   if(CopyBuffer(g_hRsi,     0, 0, 3, rsi)  < 3) return;
   g_lastM15B = m15;
   if(!EntryAllowed()) return;

   bool up = emaF[1] > emaS[1] && rsi[1] > 50.0;
   bool dn = emaF[1] < emaS[1] && rsi[1] < 50.0;
   if(InpGhostBCrossOnly) { up = up && emaF[2] <= emaS[2]; dn = dn && emaF[2] >= emaS[2]; }

   double lot = CalcLot(GH_B);
   if(lot <= 0) return;
   double slD = rd[GH_B].sl * g_unit, tpD = rd[GH_B].tp * g_unit;
   if(slD < MinDistance() || (tpD > 0 && tpD < MinDistance())) { Log("RiderB: SL/TP closer than stops level - skipped"); return; }

   g_trade.SetExpertMagicNumber(rd[GH_B].magic);
   g_trade.SetDeviationInPoints(rd[GH_B].slipPts);

   if(rd[GH_B].dir != DIR_SELL_ONLY && up) {
      double ask = g_sym.Ask();
      if(MarginOK(ORDER_TYPE_BUY, lot, ask)) {
         if(g_trade.Buy(lot, _Symbol, ask, NormalizeDouble(ask - slD, _Digits), tpD > 0 ? NormalizeDouble(ask + tpD, _Digits) : 0.0, rd[GH_B].tag))
            Log("RiderB BUY @ " + DoubleToString(ask, _Digits) + " lot " + DoubleToString(lot, 2));
         else { Note("RR-B buy failed rc=" + (string)g_trade.ResultRetcode()); Print("RiderB BUY FAILED rc=", g_trade.ResultRetcode(), " ", g_trade.ResultRetcodeDescription()); }
      }
   }
   else if(rd[GH_B].dir != DIR_BUY_ONLY && dn) {
      double bid = g_sym.Bid();
      if(MarginOK(ORDER_TYPE_SELL, lot, bid)) {
         if(g_trade.Sell(lot, _Symbol, bid, NormalizeDouble(bid + slD, _Digits), tpD > 0 ? NormalizeDouble(bid - tpD, _Digits) : 0.0, rd[GH_B].tag))
            Log("RiderB SELL @ " + DoubleToString(bid, _Digits) + " lot " + DoubleToString(lot, 2));
         else { Note("RR-B sell failed rc=" + (string)g_trade.ResultRetcode()); Print("RiderB SELL FAILED rc=", g_trade.ResultRetcode(), " ", g_trade.ResultRetcodeDescription()); }
      }
   }
}

//+------------------------------------------------------------------+
void GhostC_Tick()
{
   MqlDateTime dt; TimeCurrent(dt);
   if(dt.hour != InpSessionHour1C && dt.hour != InpSessionHour2C) return;

   datetime day = iTime(_Symbol, PERIOD_D1, 0);
   datetime sessionKey = day + (datetime)(dt.hour * 3600);
   if(sessionKey == g_lastSessionC) return;                    // one attempt per session per day
   g_lastSessionC = sessionKey;

   CancelPending(rd[GH_C].magic);                               // drop anything left from the previous session
   if(dt.day_of_week == 0 || dt.day_of_week == 6) return;
   if(HasOpenPosition(rd[GH_C].magic) || !EntryAllowed()) return;

   double hi = 0.0, lo = DBL_MAX;
   for(int k = 1; k <= 7; k++) {
      double h = iHigh(_Symbol, PERIOD_H1, k), l = iLow(_Symbol, PERIOD_H1, k);
      if(h > hi) hi = h;
      if(l > 0 && l < lo) lo = l;
   }
   if(hi <= 0 || lo == DBL_MAX) return;
   PlaceBreakoutPair(GH_C, hi, lo, 2.0 * g_unit, InpOrderLifeHoursC);
}

//+------------------------------------------------------------------+
void GhostD_Tick()
{
   datetime bar = iTime(_Symbol, PERIOD_H1, 0);
   if(bar == 0 || bar == g_lastBarD) return;                   // evaluate once per H1 bar (inputs are closed-bar values)
   g_lastBarD = bar;

   CancelPending(rd[GH_D].magic, (long)(InpOrderLifeHoursD * 3600.0) + 60);
   if(HasOpenPosition(rd[GH_D].magic) || HasPendingOrder(rd[GH_D].magic)) return;

   MqlDateTime dt; TimeCurrent(dt);
   if(dt.day_of_week == 0 || dt.day_of_week == 6) return;
   if(InpConsolidationBars < 1) return;

   int need = InpConsolidationBars + 5;
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(g_hAtr, 0, 0, need, atr) < need) return;

   double avgATR = 0.0;
   for(int k = 5; k < need; k++) avgATR += atr[k];
   avgATR /= InpConsolidationBars;
   double curATR = atr[1];
   if(curATR <= avgATR * InpATRMultiplierGhostD) return;

   double hi = 0.0, lo = DBL_MAX;
   for(int k = 1; k <= 3; k++) {
      double h = iHigh(_Symbol, PERIOD_H1, k), l = iLow(_Symbol, PERIOD_H1, k);
      if(h > hi) hi = h;
      if(l > 0 && l < lo) lo = l;
   }
   if(hi <= 0 || lo == DBL_MAX) return;
   if(hi - lo < curATR * 0.3) return;
   if(!EntryAllowed()) return;

   double c = iClose(_Symbol, PERIOD_H1, 1), o = iOpen(_Symbol, PERIOD_H1, 1);
   double lot = CalcLot(GH_D);
   if(lot <= 0) return;
   double buffer = g_unit;
   if(rd[GH_D].dir != DIR_SELL_ONLY && c > o) PlaceStop(GH_D, true,  hi + buffer, lot, InpOrderLifeHoursD);
   if(rd[GH_D].dir != DIR_BUY_ONLY  && c < o) PlaceStop(GH_D, false, lo - buffer, lot, InpOrderLifeHoursD);
}

//+------------------------------------------------------------------+
void ManageTrailing()
{
   double minGap = MinDistance();
   for(int p = PositionsTotal() - 1; p >= 0; p--) {
      if(!g_pos.SelectByIndex(p) || g_pos.Symbol() != _Symbol) continue;
      int gi = -1;
      for(int k = 0; k < 4; k++) if(rd[k].on && rd[k].magic == g_pos.Magic()) { gi = k; break; }
      if(gi < 0) continue;

      double start = rd[gi].trStart * g_unit, dist = rd[gi].trDist * g_unit, step = rd[gi].trStep * g_unit;
      double curSL = g_pos.StopLoss(), curTP = g_pos.TakeProfit(), open = g_pos.PriceOpen();
      double bid = g_sym.Bid(), ask = g_sym.Ask();

      if(g_pos.PositionType() == POSITION_TYPE_BUY) {
         if(bid - open < start) continue;
         double cand = MathMin(bid - dist, bid - minGap);
         if(rd[gi].trMode == TRAIL_CUSTOM) cand = MathMin(MathMax(cand, open), bid - minGap);   // breakeven first, trail once profit > distance
         double nsl = NormalizeDouble(cand, _Digits);
         if(curSL == 0 || nsl > curSL + step) {
            if(curTP > 0 && MathAbs(curTP - bid) <= minGap) continue;
            if(!g_trade.PositionModify(g_pos.Ticket(), nsl, curTP)) Log("Trail buy failed rc=" + (string)g_trade.ResultRetcode());
         }
      }
      else if(g_pos.PositionType() == POSITION_TYPE_SELL) {
         if(open - ask < start) continue;
         double cand = MathMax(ask + dist, ask + minGap);
         if(rd[gi].trMode == TRAIL_CUSTOM) cand = MathMax(MathMin(cand, open), ask + minGap);
         double nsl = NormalizeDouble(cand, _Digits);
         if(curSL == 0 || nsl < curSL - step) {
            if(curTP > 0 && MathAbs(curTP - ask) <= minGap) continue;
            if(!g_trade.PositionModify(g_pos.Ticket(), nsl, curTP)) Log("Trail sell failed rc=" + (string)g_trade.ResultRetcode());
         }
      }
   }
}

//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| ON-CHART DASHBOARD                                               |
//+------------------------------------------------------------------+
void News_Tick()
{
   if(!InpEnableNewsFilter) { g_newsBlocked = false; return; }
   if(MQLInfoInteger(MQL_TESTER)) {
      if(!g_newsTesterWarned) { g_newsTesterWarned = true; Print("News filter: WebRequest is not available in the Strategy Tester - filter inactive in backtests."); }
      return;
   }
   datetime nowL = TimeLocal();
   if((g_newsFetchedAt == 0 || nowL - g_newsFetchedAt > 4 * 3600) && nowL >= g_newsNextTry) {
      if(News_Fetch()) g_newsFetchedAt = nowL; else g_newsNextTry = nowL + 900;
   }
   string why = "";
   bool b = News_Compute(why);
   if(b && !g_newsBlocked) {
      for(int k = 0; k < 4; k++) if(rd[k].on) CancelPending(rd[k].magic);
      Note("news block: " + why);
      Print("News filter: entries blocked - ", why);
   }
   if(!b && g_newsBlocked) { Note("news block ended"); Print("News filter: window ended, entries allowed again"); }
   g_newsBlocked = b;
}

struct RiderStat { int trades; int wins; double net, gp, gl, today, open; int pos, pend; };

CCanvas    g_cv;
bool       g_dashOn = false;
int        g_dw = 0, g_dh = 0;
RiderStat  g_gs[4];
double     g_eq[180];
int        g_eqN = 0;
double     g_peakEq = 0.0;
datetime   g_lastSample = 0, g_lastHist = 0;
string     g_rName[4] = {"RIDER A", "RIDER B", "RIDER C", "RIDER D"};
string     g_rDesc[4] = {"H1 BREAKOUT", "M15 MOMENTUM", "SESSION", "VOLATILITY"};
uint       g_rClr[4];

uint AR(int r, int gg, int b, int a = 255) { return ((uint)a << 24) | ((uint)r << 16) | ((uint)gg << 8) | (uint)b; }

uint MixC(uint c1, uint c2, double t)
{
   if(t < 0) t = 0;
   if(t > 1) t = 1;
   int a = (int)(((c1 >> 24) & 0xFF) * (1 - t) + ((c2 >> 24) & 0xFF) * t);
   int r = (int)(((c1 >> 16) & 0xFF) * (1 - t) + ((c2 >> 16) & 0xFF) * t);
   int gg = (int)(((c1 >> 8) & 0xFF) * (1 - t) + ((c2 >> 8) & 0xFF) * t);
   int b = (int)((c1 & 0xFF) * (1 - t) + (c2 & 0xFF) * t);
   return AR(r, gg, b, a);
}

string Num(double v, int d = 2)
{
   string s = DoubleToString(MathAbs(v), d);
   int dot = StringFind(s, ".");
   string ip = (dot < 0) ? s : StringSubstr(s, 0, dot);
   string fp = (dot < 0) ? "" : StringSubstr(s, dot);
   string out = "";
   int n = StringLen(ip);
   for(int i = 0; i < n; i++) {
      out += StringSubstr(ip, i, 1);
      int rem = n - 1 - i;
      if(rem > 0 && rem % 3 == 0) out += ",";
   }
   return (v < 0 ? "-" : "") + out + fp;
}

string Sgn(double v) { return (v >= 0 ? "+" : "") + Num(v); }

uint PnlClr(double v) { return v > 0 ? AR(70, 230, 140) : (v < 0 ? AR(255, 80, 100) : AR(232, 236, 255)); }

void VGrad(int x, int y, int w, int h, uint c1, uint c2)
{
   for(int i = 0; i < h; i++)
      g_cv.FillRectangle(x, y + i, x + w - 1, y + i, MixC(c1, c2, h > 1 ? (double)i / (h - 1) : 0.0));
}

void HGrad(int x, int y, int w, int h, uint c1, uint c2)
{
   for(int i = 0; i < w; i++)
      g_cv.FillRectangle(x + i, y, x + i, y + h - 1, MixC(c1, c2, w > 1 ? (double)i / (w - 1) : 0.0));
}

void Tx(int x, int y, string s, uint clr, int pt, bool bold = true, uint align = TA_LEFT | TA_TOP, uint sh = 0xFF000000)
{
   g_cv.FontSet("Segoe UI", -pt * 10, bold ? FW_BOLD : FW_NORMAL);
   g_cv.TextOut(x + 1, y + 1, s, sh, align);
   g_cv.TextOut(x, y, s, clr, align);
}

void Card3D(int x, int y, int w, int h, uint accent)
{
   g_cv.FillRectangle(x + 5, y + 6, x + w + 4, y + h + 5, AR(0, 0, 0, 60));
   g_cv.FillRectangle(x + 3, y + 4, x + w + 2, y + h + 3, AR(0, 0, 0, 100));
   VGrad(x, y, w, h, AR(46, 52, 84), AR(18, 21, 42));
   g_cv.FillRectangle(x, y, x + w - 1, y + 1, AR(90, 100, 152));
   g_cv.FillRectangle(x, y, x, y + h - 1, AR(70, 78, 120));
   g_cv.FillRectangle(x, y + h - 2, x + w - 1, y + h - 1, AR(5, 6, 13));
   g_cv.FillRectangle(x + w - 1, y, x + w - 1, y + h - 1, AR(8, 10, 20));
   g_cv.FillRectangle(x, y + 2, x + 3, y + h - 3, accent);
}

void Kpi(int x, int y, int w, int h, string label, string val, uint valClr, uint accent)
{
   Card3D(x, y, w, h, accent);
   Tx(x + 12, y + 6, label, AR(140, 151, 200), 8, false);
   Tx(x + 12, y + 22, val, valClr, 15, true);
}

int GhostIdx(long m)
{
   for(int k = 0; k < 4; k++) if(rd[k].magic == m) return k;
   return -1;
}

string RiderStatus(int k, uint &bg, uint &fg)
{
   if(!rd[k].on)        { bg = AR(60, 66, 100); fg = AR(160, 170, 210); return "OFF"; }
   if(g_gs[k].pos > 0)  { bg = AR(70, 230, 140); fg = AR(6, 48, 26);   return "IN TRADE"; }
   if(g_gs[k].pend > 0) { bg = AR(255, 200, 60); fg = AR(58, 42, 0);   return "PENDING"; }
   bg = AR(74, 82, 128); fg = AR(214, 220, 255);
   return "IDLE";
}

void Dash_Collect()
{
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(eq > g_peakEq) g_peakEq = eq;

   datetime nowL = TimeLocal();
   if(g_eqN == 0 || nowL - g_lastSample >= 20) {
      g_lastSample = nowL;
      if(g_eqN == 180) { for(int i = 1; i < 180; i++) g_eq[i - 1] = g_eq[i]; g_eq[179] = eq; }
      else g_eq[g_eqN++] = eq;
   }

   for(int k = 0; k < 4; k++) { g_gs[k].open = 0; g_gs[k].pos = 0; g_gs[k].pend = 0; }
   for(int p = PositionsTotal() - 1; p >= 0; p--) {
      if(!g_pos.SelectByIndex(p) || g_pos.Symbol() != _Symbol) continue;
      int k = GhostIdx(g_pos.Magic());
      if(k < 0) continue;
      g_gs[k].open += g_pos.Profit() + g_pos.Swap();
      g_gs[k].pos++;
   }
   for(int o = OrdersTotal() - 1; o >= 0; o--) {
      ulong t = OrderGetTicket(o);
      if(t == 0 || OrderGetString(ORDER_SYMBOL) != _Symbol) continue;
      int k = GhostIdx(OrderGetInteger(ORDER_MAGIC));
      if(k >= 0) g_gs[k].pend++;
   }

   if(g_lastHist != 0 && nowL - g_lastHist < 5) return;       // closed-deal stats refresh every 5 s
   g_lastHist = nowL;
   datetime now = TimeCurrent();
   datetime today = iTime(_Symbol, PERIOD_D1, 0);
   if(!HistorySelect(now - 30 * 86400, now + 86400)) return;
   for(int k = 0; k < 4; k++) { g_gs[k].trades = 0; g_gs[k].wins = 0; g_gs[k].net = 0; g_gs[k].gp = 0; g_gs[k].gl = 0; g_gs[k].today = 0; }
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++) {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      long en = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(en != DEAL_ENTRY_OUT && en != DEAL_ENTRY_INOUT && en != DEAL_ENTRY_OUT_BY) continue;
      if(HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      int k = GhostIdx(HistoryDealGetInteger(tk, DEAL_MAGIC));
      if(k < 0) continue;
      double pr = HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION);
      g_gs[k].trades++;
      g_gs[k].net += pr;
      if(pr > 0) { g_gs[k].wins++; g_gs[k].gp += pr; } else g_gs[k].gl += pr;
      if((datetime)HistoryDealGetInteger(tk, DEAL_TIME) >= today) g_gs[k].today += pr;
   }
}

void Spark(int x, int y, int w, int h, uint accent)
{
   if(g_eqN < 2) { Tx(x + w / 2, y + h / 2 - 7, "collecting data...", AR(140, 151, 200), 9, false, TA_CENTER | TA_TOP); return; }
   double mn = DBL_MAX, mx = -DBL_MAX;
   for(int i = 0; i < g_eqN; i++) { mn = MathMin(mn, g_eq[i]); mx = MathMax(mx, g_eq[i]); }
   if(mx - mn < 1e-9) mx = mn + 1.0;
   uint fill = MixC(AR(20, 24, 46), accent, 0.30);
   int ppx = 0, ppy = 0;
   for(int i = 0; i < g_eqN; i++) {
      int px = x + (int)((double)i / (g_eqN - 1) * (w - 1));
      int py = y + h - 1 - (int)((g_eq[i] - mn) / (mx - mn) * (h - 1));
      g_cv.FillRectangle(px, py, px, y + h - 1, fill);
      if(i > 0) { g_cv.Line(ppx, ppy, px, py, accent); g_cv.Line(ppx, ppy + 1, px, py + 1, accent); }
      ppx = px; ppy = py;
   }
}

void Dash_DrawBig()
{
   int pw = g_dw - 6, ph = g_dh - 6, x0 = 10, cw = pw - 20, y = 10;
   uint gray = AR(140, 151, 200), cyan = AR(60, 200, 255), white = AR(232, 236, 255);

   g_cv.FillRectangle(6, 7, g_dw - 1, g_dh - 1, AR(0, 0, 0, 80));
   VGrad(0, 0, pw, ph, AR(23, 27, 46), AR(13, 16, 32));
   g_cv.Rectangle(0, 0, pw - 1, ph - 1, AR(42, 49, 80));

   // header
   HGrad(x0, y, cw, 54, AR(42, 47, 107), AR(18, 32, 63));
   HGrad(x0, y + 51, cw, 3, AR(60, 200, 255), AR(150, 112, 255));
   Tx(x0 + 12, y + 5, "RANGE RIDER", white, 17, true, TA_LEFT | TA_TOP, AR(28, 127, 168));
   string mode = AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL ? "LIVE ACCOUNT" : "DEMO";
   Tx(x0 + 12, y + 33, "v4.2 | " + _Symbol + " | " + AccountInfoString(ACCOUNT_SERVER) + " | " + mode, AR(154, 166, 216), 8, false);
   Tx(x0 + cw - 10, y + 6, TimeToString(TimeCurrent(), TIME_SECONDS), cyan, 12, true, TA_RIGHT | TA_TOP);
   bool tradeOn = TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && MQLInfoInteger(MQL_TRADE_ALLOWED);
   Tx(x0 + cw - 10, y + 30, tradeOn ? "LIVE" : "TRADING OFF", tradeOn ? AR(70, 230, 140) : AR(255, 80, 100), 9, true, TA_RIGHT | TA_TOP);
   y += 54 + 8;

   // account KPIs
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double fl = eq - bal, today = 0, tot = 0;
   for(int k = 0; k < 4; k++) { today += g_gs[k].today; tot += g_gs[k].net; }
   double ml = AccountInfoDouble(ACCOUNT_MARGIN_LEVEL);
   int kw = (cw - 16) / 3, kh = 56;
   Kpi(x0,                y, kw, kh, "BALANCE",        Num(bal),  white, cyan);
   Kpi(x0 + kw + 8,       y, kw, kh, "EQUITY",         Num(eq),   white, cyan);
   Kpi(x0 + 2 * (kw + 8), y, kw, kh, "FLOATING P/L",   Sgn(fl),   PnlClr(fl), PnlClr(fl));
   y += kh + 8;
   Kpi(x0,                y, kw, kh, "TODAY (CLOSED)", Sgn(today), PnlClr(today), PnlClr(today));
   Kpi(x0 + kw + 8,       y, kw, kh, "LAST 30 DAYS",   Sgn(tot),   PnlClr(tot),   PnlClr(tot));
   Kpi(x0 + 2 * (kw + 8), y, kw, kh, "MARGIN LEVEL",   ml > 0 ? Num(ml, 0) + "%" : "-", white, AR(255, 200, 60));
   y += kh + 8;

   // drawdown meter
   double dd = g_peakEq > 0 ? (g_peakEq - eq) / g_peakEq * 100.0 : 0.0;
   Card3D(x0, y, cw, 46, dd < 5 ? AR(70, 230, 140) : (dd < 15 ? AR(255, 200, 60) : AR(255, 80, 100)));
   Tx(x0 + 12, y + 6, "DRAWDOWN FROM PEAK", gray, 8, false);
   Tx(x0 + cw - 10, y + 5, Num(dd, 1) + "%", dd < 5 ? AR(70, 230, 140) : (dd < 15 ? AR(255, 200, 60) : AR(255, 80, 100)), 10, true, TA_RIGHT | TA_TOP);
   int segs = 36, sx = x0 + 12, sw = (cw - 24 - (segs - 1)) / segs;
   int lit = (int)MathRound(MathMin(1.0, dd / MathMax(1.0, InpDashDDScale)) * segs);
   for(int s = 0; s < segs; s++) {
      uint c = s < lit ? (s < segs / 2 ? MixC(AR(70, 230, 140), AR(255, 200, 60), (double)s / (segs / 2)) : MixC(AR(255, 200, 60), AR(255, 80, 100), (double)(s - segs / 2) / (segs / 2)))
                       : AR(34, 40, 72);
      g_cv.FillRectangle(sx + s * (sw + 1), y + 26, sx + s * (sw + 1) + sw - 1, y + 37, c);
   }
   y += 46 + 8;

   // equity sparkline
   Card3D(x0, y, cw, 78, cyan);
   Tx(x0 + 12, y + 5, "EQUITY | last hour", gray, 8, false);
   Spark(x0 + 12, y + 22, cw - 24, 48, cyan);
   y += 78 + 8;

   // rider cards
   int rw = (cw - 8) / 2, rh = 82;
   for(int k = 0; k < 4; k++) {
      int cx = x0 + (k % 2) * (rw + 8), cy = y + (k / 2) * (rh + 8);
      Card3D(cx, cy, rw, rh, g_rClr[k]);
      Tx(cx + 12, cy + 6, g_rName[k] + " | " + g_rDesc[k], g_rClr[k], 8, true);
      uint bg, fg;
      string st = RiderStatus(k, bg, fg);
      g_cv.FillRectangle(cx + rw - 74, cy + 5, cx + rw - 8, cy + 20, bg);
      Tx(cx + rw - 41, cy + 6, st, fg, 8, true, TA_CENTER | TA_TOP, bg);
      Tx(cx + 12, cy + 25, "OPEN", gray, 8, false);
      Tx(cx + rw / 2 + 4, cy + 25, "30D NET", gray, 8, false);
      Tx(cx + 12, cy + 36, Sgn(g_gs[k].open), PnlClr(g_gs[k].open), 13, true);
      Tx(cx + rw / 2 + 4, cy + 36, Sgn(g_gs[k].net), PnlClr(g_gs[k].net), 13, true);
      string pf = g_gs[k].gl < 0 ? DoubleToString(g_gs[k].gp / -g_gs[k].gl, 2) : (g_gs[k].gp > 0 ? "max" : "-");
      string wr = g_gs[k].trades > 0 ? DoubleToString(100.0 * g_gs[k].wins / g_gs[k].trades, 0) + "%" : "-";
      Tx(cx + 12, cy + 62, (string)g_gs[k].trades + " trades | WR " + wr + " | PF " + pf, gray, 8, false);
   }
   y += 2 * (rh + 8);

   // footer
   Card3D(x0, y, cw, 26, AR(90, 100, 152));
   Tx(x0 + 12, y + 6, "Spread " + (string)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) + " pts | Unit " + DoubleToString(g_unit, _Digits), gray, 8, false);
   Tx(x0 + cw - 10, y + 6, StringSubstr(g_lastMsg, 0, 44), AR(255, 200, 60), 8, false, TA_RIGHT | TA_TOP);
}

void Dash_DrawSmall()
{
   int pw = g_dw - 6, ph = g_dh - 6, x0 = 10, cw = pw - 20, y = 10;
   uint gray = AR(140, 151, 200), cyan = AR(60, 200, 255), white = AR(232, 236, 255);

   g_cv.FillRectangle(6, 7, g_dw - 1, g_dh - 1, AR(0, 0, 0, 80));
   VGrad(0, 0, pw, ph, AR(23, 27, 46), AR(13, 16, 32));
   g_cv.Rectangle(0, 0, pw - 1, ph - 1, AR(42, 49, 80));

   HGrad(x0, y, cw, 38, AR(42, 47, 107), AR(18, 32, 63));
   HGrad(x0, y + 35, cw, 3, AR(60, 200, 255), AR(150, 112, 255));
   Tx(x0 + 10, y + 4, "RANGE RIDER", white, 12, true, TA_LEFT | TA_TOP, AR(28, 127, 168));
   Tx(x0 + cw - 8, y + 6, _Symbol, cyan, 9, true, TA_RIGHT | TA_TOP);
   y += 38 + 8;

   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY), today = 0;
   for(int k = 0; k < 4; k++) today += g_gs[k].today;
   double dd = g_peakEq > 0 ? (g_peakEq - eq) / g_peakEq * 100.0 : 0.0;
   int kw = (cw - 8) / 2, kh = 52;
   Kpi(x0,          y, kw, kh, "BALANCE", Num(bal), white, cyan);
   Kpi(x0 + kw + 8, y, kw, kh, "EQUITY",  Num(eq),  white, cyan);
   y += kh + 8;
   Kpi(x0,          y, kw, kh, "TODAY (CLOSED)", Sgn(today), PnlClr(today), PnlClr(today));
   Kpi(x0 + kw + 8, y, kw, kh, "DRAWDOWN", Num(dd, 1) + "%", dd < 5 ? AR(70, 230, 140) : (dd < 15 ? AR(255, 200, 60) : AR(255, 80, 100)), AR(255, 200, 60));
   y += kh + 8;

   int cwid = (cw - 18) / 4;
   for(int k = 0; k < 4; k++) {
      uint bg, fg;
      string st = RiderStatus(k, bg, fg);
      int cx = x0 + k * (cwid + 6);
      Card3D(cx, y, cwid, 34, bg);
      Tx(cx + 9, y + 4, StringSubstr(g_rName[k], 6, 1), g_rClr[k], 11, true);
      Tx(cx + 26, y + 7, st == "IN TRADE" ? "TRADE" : (st == "PENDING" ? "PEND" : st), bg, 8, true);
      Tx(cx + 9, y + 19, Sgn(g_gs[k].open), PnlClr(g_gs[k].open), 8, false);
   }
}

void Dash_Update()
{
   if(!g_dashOn) return;
   Dash_Collect();
   g_cv.Erase(0);
   if(InpDashboardMode == DASH_BIG) Dash_DrawBig(); else Dash_DrawSmall();
   g_cv.Update();
}

void Dash_Init()
{
   g_dashOn = false;
   if(InpDashboardMode == DASH_DISABLED) return;
   if(MQLInfoInteger(MQL_TESTER) && (!InpDashInTester || !MQLInfoInteger(MQL_VISUAL_MODE))) return;   // keeps backtests fast

   g_dw = (InpDashboardMode == DASH_BIG) ? 490 : 310;
   g_dh = (InpDashboardMode == DASH_BIG) ? 562 : 226;
   string nm = "RR_DASH_" + (string)InpMagicGhostA;
   if(!g_cv.CreateBitmapLabel(0, 0, nm, InpDashX, InpDashY, g_dw, g_dh, COLOR_FORMAT_ARGB_NORMALIZE)) {
      Print("Dashboard canvas failed, err ", GetLastError());
      return;
   }
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   g_rClr[0] = AR(60, 200, 255); g_rClr[1] = AR(150, 112, 255); g_rClr[2] = AR(255, 200, 60); g_rClr[3] = AR(255, 110, 180);
   g_peakEq = AccountInfoDouble(ACCOUNT_EQUITY);
   g_dashOn = true;
   EventSetTimer(1);
   Dash_Update();
}

void Dash_Deinit()
{
   if(!g_dashOn) return;
   EventKillTimer();
   g_cv.Destroy();
   g_dashOn = false;
}

void OnTimer() { Dash_Update(); }

//+------------------------------------------------------------------+
int OnInit()
{
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING) {
      Print("Range Rider needs a HEDGING account (4 riders share one symbol). Netting account detected - stopping.");
      return INIT_FAILED;
   }

   g_sym.Name(_Symbol);
   g_sym.Refresh();
   g_unit = InpUnitOverride > 0 ? InpUnitOverride : ((_Digits == 3 || _Digits == 5) ? 10.0 * _Point : _Point);

   LoadCfg(GH_A, InpEnableGhostA, InpMagicGhostA, InpDirectionGhostA, InpLotModeGhostA, InpFixedLotGhostA, InpRiskGhostA, InpBalanceRefGhostA,
           InpStopLossGhostA, InpTakeProfitGhostA, InpTrailStartGhostA, InpTrailDistGhostA, InpTrailStepGhostA, InpSlippageGhostA, "RR-A");
   LoadCfg(GH_B, InpEnableGhostB, InpMagicGhostB, InpDirectionGhostB, InpLotModeGhostB, InpFixedLotGhostB, InpRiskGhostB, InpBalanceRefGhostB,
           InpStopLossGhostB, InpTakeProfitGhostB, InpTrailStartGhostB, InpTrailDistGhostB, InpTrailStepGhostB, InpSlippageGhostB, "RR-B");
   LoadCfg(GH_C, InpEnableGhostC, InpMagicGhostC, InpDirectionGhostC, InpLotModeGhostC, InpFixedLotGhostC, InpRiskGhostC, InpBalanceRefGhostC,
           InpStopLossGhostC, InpTakeProfitGhostC, InpTrailStartGhostC, InpTrailDistGhostC, InpTrailStepGhostC, InpSlippageGhostC, "RR-C");
   LoadCfg(GH_D, InpEnableGhostD, InpMagicGhostD, InpDirectionGhostD, InpLotModeGhostD, InpFixedLotGhostD, InpRiskGhostD, InpBalanceRefGhostD,
           InpStopLossGhostD, InpTakeProfitGhostD, InpTrailStartGhostD, InpTrailDistGhostD, InpTrailStepGhostD, InpSlippageGhostD, "RR-D");
   rd[GH_A].trMode = InpTrailModeGhostA; rd[GH_B].trMode = InpTrailModeGhostB;
   rd[GH_C].trMode = InpTrailModeGhostC; rd[GH_D].trMode = InpTrailModeGhostD;

   for(int k = 0; k < 4; k++) {
      if(!rd[k].on) continue;
      if(rd[k].sl <= 0) { Print("Invalid input: ", rd[k].tag, " stop loss must be > 0"); return INIT_PARAMETERS_INCORRECT; }
      if(rd[k].fixedLot <= 0 && rd[k].lotMode != LOT_RISK) { Print("Invalid input: ", rd[k].tag, " fixed lot must be > 0"); return INIT_PARAMETERS_INCORRECT; }
      for(int m = k + 1; m < 4; m++)
         if(rd[m].on && rd[m].magic == rd[k].magic) { Print("Invalid input: duplicate magic numbers"); return INIT_PARAMETERS_INCORRECT; }
   }

   if(rd[GH_B].on) {
      g_hEmaFast = iMA(_Symbol, PERIOD_M15, 20, 0, MODE_EMA, PRICE_CLOSE);
      g_hEmaSlow = iMA(_Symbol, PERIOD_M15, 50, 0, MODE_EMA, PRICE_CLOSE);
      g_hRsi     = iRSI(_Symbol, PERIOD_M15, 14, PRICE_CLOSE);
      if(g_hEmaFast == INVALID_HANDLE || g_hEmaSlow == INVALID_HANDLE || g_hRsi == INVALID_HANDLE) { Print("Rider B indicators failed"); return INIT_FAILED; }
   }
   if(rd[GH_D].on) {
      g_hAtr = iATR(_Symbol, PERIOD_H1, InpATRPeriodGhostD);
      if(g_hAtr == INVALID_HANDLE) { Print("Rider D ATR failed"); return INIT_FAILED; }
   }

   UpdateDay();

   // Always print what the inputs really mean on THIS symbol/broker
   double ts = g_sym.TickSize(), tv = g_sym.TickValue();
   Print("Range Rider v4.2 | ", _Symbol, " | digits ", _Digits, " | 1 input unit = ", DoubleToString(g_unit, _Digits), " price");
   Print("Stops level ", SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL), " pts | spread ", SymbolInfoInteger(_Symbol, SYMBOL_SPREAD), " pts | lot min/step ",
         g_sym.LotsMin(), "/", g_sym.LotsStep());
   for(int k = 0; k < 4; k++) {
      if(!rd[k].on) continue;
      double slMoney = (ts > 0) ? (rd[k].sl * g_unit / ts) * tv : 0.0;
      Print(rd[k].tag, " ON | SL ", DoubleToString(rd[k].sl * g_unit, _Digits), " price = ", DoubleToString(slMoney, 2), " ", AccountInfoString(ACCOUNT_CURRENCY), " per 1.00 lot");
   }
   Dash_Init();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   Dash_Deinit();
   if(g_hEmaFast != INVALID_HANDLE) IndicatorRelease(g_hEmaFast);
   if(g_hEmaSlow != INVALID_HANDLE) IndicatorRelease(g_hEmaSlow);
   if(g_hRsi     != INVALID_HANDLE) IndicatorRelease(g_hRsi);
   if(g_hAtr     != INVALID_HANDLE) IndicatorRelease(g_hAtr);
   Log("Range Rider v4.2 stopped, reason " + (string)reason);
}

void OnTick()
{
   g_sym.Refresh();
   g_sym.RefreshRates();     // Bid()/Ask() are cached ticks - without this they stay 0
   UpdateDay();
   g_trade.SetTypeFillingBySymbol(_Symbol);
   News_Tick();

   for(int k = 0; k < 4; k++) if(rd[k].on && k != GH_B) CancelOppositeIfFilled(k);

   if(rd[GH_A].on) {
      datetime bar = iTime(_Symbol, PERIOD_H1, 0);
      if(bar > 0 && bar != g_lastBarA) {
         g_lastBarA = bar;
         CancelPending(rd[GH_A].magic);
         if(!HasOpenPosition(rd[GH_A].magic) && EntryAllowed()) GhostA_Entry();
      }
   }
   if(rd[GH_B].on) GhostB_Entry();
   if(rd[GH_C].on) GhostC_Tick();
   if(rd[GH_D].on) GhostD_Tick();

   ManageTrailing();
}
//+------------------------------------------------------------------+

