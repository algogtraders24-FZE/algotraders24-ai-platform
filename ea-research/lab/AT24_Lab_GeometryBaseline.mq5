//+------------------------------------------------------------------+
//| AT24_Lab_GeometryBaseline.mq5  (research control, NOT a product) |
//| Question it answers: how much of a result comes from the trade   |
//| geometry (SL/TP in ATR, max hold, risk) and the market regime,   |
//| and how much from entry timing? Entries are RANDOM (or simple    |
//| trend-side) with fixed SL/TP/hold. If this control earns about   |
//| the same as a system, the system's entry adds no edge.           |
//+------------------------------------------------------------------+
#property version   "1.00"
#property description "Research control: random entries, fixed ATR SL/TP geometry. Not a trading product."
#include "../AT24_EA_Core/Include/AT24_EA_Core.mqh"

enum ENUM_DIR_MODE { DIR_RANDOM = 0, DIR_WITH_TREND = 1, DIR_AGAINST_TREND = 2 };

input group "=== GEOMETRY ==="
input double InpSL_ATR        = 3.76;   // SL distance in ATR(14)
input double InpTP_ATR        = 2.63;   // TP distance in ATR(14)
input int    InpMaxHoldHours  = 36;     // force close after N hours
input double InpRiskPercent   = 1.0;    // risk per trade (of equity) at the SL distance
input group "=== ENTRIES ==="
input ENUM_DIR_MODE InpDirMode = DIR_RANDOM;
input double InpEntryProb     = 0.008;  // chance of an entry on each new bar (about 75 trades / 9 months on M30)
input int    InpMaxPerDay     = 2;
input int    InpSeed          = 1;      // random seed (run several seeds)
input long   InpMagic         = 4242001;

CAT24Exec g_exec;
int       g_atr = INVALID_HANDLE, g_ema = INVALID_HANDLE;
datetime  g_lastBar = 0;
int       g_dayKey = 0, g_today = 0;

int OnInit()
  {
   SAT24ExecConfig cfg; cfg.Defaults(); cfg.magic = (ulong)InpMagic; cfg.deviation_points = 100; cfg.margin_buffer_pct = 0.0; cfg.verbose = false;
   g_exec.Init(_Symbol, cfg);
   g_atr = iATR(_Symbol, _Period, 14);
   g_ema = iMA(_Symbol, _Period, 50, 0, MODE_EMA, PRICE_CLOSE);
   if(g_atr == INVALID_HANDLE || g_ema == INVALID_HANDLE) return INIT_FAILED;
   MathSrand(InpSeed);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   if(g_atr != INVALID_HANDLE) IndicatorRelease(g_atr);
   if(g_ema != INVALID_HANDLE) IndicatorRelease(g_ema);
  }

void CloseExpired()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagic || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(TimeCurrent() - (datetime)PositionGetInteger(POSITION_TIME) >= InpMaxHoldHours * 3600)
        { SAT24ExecResult r; g_exec.Close(t, 0.0, r); }
     }
  }

bool HasPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(PositionGetTicket(i) != 0 && PositionGetInteger(POSITION_MAGIC) == InpMagic && PositionGetString(POSITION_SYMBOL) == _Symbol) return true;
   return false;
  }

void OnTick()
  {
   CloseExpired();
   datetime bar = iTime(_Symbol, _Period, 0);
   if(bar == g_lastBar) return;
   g_lastBar = bar;
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt);
   int key = dt.year * 1000 + dt.day_of_year;
   if(key != g_dayKey) { g_dayKey = key; g_today = 0; }
   if(dt.day_of_week == 0 || dt.day_of_week == 6) return;
   if(HasPosition() || g_today >= InpMaxPerDay) return;
   if((MathRand() / 32767.0) > InpEntryProb) return;

   double atr[1], ema[1];
   if(CopyBuffer(g_atr, 0, 1, 1, atr) != 1 || CopyBuffer(g_ema, 0, 1, 1, ema) != 1 || atr[0] <= 0.0) return;
   double close1 = iClose(_Symbol, _Period, 1);
   bool buy;
   if(InpDirMode == DIR_RANDOM) buy = (MathRand() % 2 == 0);
   else buy = (InpDirMode == DIR_WITH_TREND) ? (close1 > ema[0]) : (close1 < ema[0]);

   MqlTick t; if(!SymbolInfoTick(_Symbol, t)) return;
   double px = buy ? t.ask : t.bid;
   double sl = buy ? px - InpSL_ATR * atr[0] : px + InpSL_ATR * atr[0];
   double tp = buy ? px + InpTP_ATR * atr[0] : px - InpTP_ATR * atr[0];
   double lot = AT24_LotForRisk(_Symbol, buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, InpRiskPercent, px, sl);
   if(lot <= 0.0) return;
   SAT24ExecResult r;
   if(g_exec.Open(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, lot, sl, tp, "geom-baseline", r)) g_today++;
  }
