//+------------------------------------------------------------------+
//| AT24_GOLD_G01_LiquiditySweep_MSS_FVG.mq5                           |
//| Algotraders24 AI -- Independent Gold EA Research Series            |
//| EA ID: G01  |  v0.1 -- Frozen Research Baseline                    |
//| Instrument: XAUUSD  |  Platform: MetaTrader 5 / MQL5                |
//|                                                                       |
//| Strategy: Liquidity Sweep -> Displacement -> Market Structure Shift |
//|           -> Fair Value Gap -> FVG Retest -> Entry                  |
//|                                                                       |
//| RESEARCH BASELINE: this is one independent, self-contained          |
//| strategy. It reads only its own market-data calculations. It does   |
//| NOT read signals from other EAs, other AT24 strategies, external    |
//| AI, ML, or manual input. See README.md for the full specification,  |
//| the state-machine explanation, the non-repainting explanation, and  |
//| Strategy Tester instructions.                                       |
//|                                                                       |
//| ARCHITECTURE: all strategy math (Liquidity/Swings/Sweep/            |
//| Displacement/MSS/FVG/Risk/Filters, under Include\) is pure,         |
//| platform-agnostic logic operating only on plain SBar data. This     |
//| file is the ONLY platform-specific layer: it fetches data via the   |
//| Utils.mqh adapter and executes trades via CTrade. Porting the       |
//| validated strategy to MT4 means rewriting this file's data-fetch/   |
//| order-execution calls and Utils.mqh's adapter functions -- every    |
//| other Include\ module is unchanged.                                 |
//+------------------------------------------------------------------+
#property copyright "Algotraders24 AI"
#property version   "1.00"
#property strict
#property description "G01 -- Liquidity Sweep + MSS + FVG frozen research baseline (XAUUSD, M5 execution)."

#include <Trade\Trade.mqh>
#include "Include\AT24_G01_Types.mqh"
#include "Include\AT24_G01_Utils.mqh"
#include "Include\AT24_G01_Liquidity.mqh"
#include "Include\AT24_G01_Swings.mqh"
#include "Include\AT24_G01_Sweep.mqh"
#include "Include\AT24_G01_Displacement.mqh"
#include "Include\AT24_G01_MSS.mqh"
#include "Include\AT24_G01_FVG.mqh"
#include "Include\AT24_G01_Risk.mqh"
#include "Include\AT24_G01_Filters.mqh"
#include "Include\AT24_G01_Logging.mqh"
#include "Include\AT24_G01_StateMachine.mqh"

//========================== INPUTS ===================================

input group "=== Identification ==="
input long   InpMagicNumber              = 24001;  // Magic number (this EA manages ONLY its own symbol+magic positions)

input group "=== Risk & Position Management ==="
input double InpRiskPercent              = 0.5;    // Risk per trade, % of account equity
input int    InpMaxTradesPerDay          = 2;       // Maximum G01 entries per calendar day
input double InpTP_RMultiple             = 2.0;     // Take-profit as a multiple of initial R (baseline 2R)
input double InpSLBufferATRMultiple      = 0.25;    // SL buffer beyond sweep extreme, as an ATR(14) multiple

input group "=== ATR ==="
input int    InpATRPeriod                = 14;      // ATR period (M5), used for displacement/penetration/SL buffer

input group "=== Swing Detection ==="
input int    InpM15SwingLookback         = 3;       // Bars each side required to confirm an M15 swing (liquidity reference)
input int    InpM5SwingLookback          = 3;       // Bars each side required to confirm an M5 swing (MSS reference)

input group "=== Liquidity ==="
input double InpEqualLevelATRTolerance   = 0.10;    // Equal High/Low clustering tolerance, as an ATR(14) multiple

input group "=== Sweep ==="
input double InpMinSweepPenetrationATR   = 0.05;    // Minimum sweep penetration beyond the level, as an ATR(14) multiple

input group "=== Displacement ==="
input double InpDisplacementBodyATRMultiple   = 1.0;  // Minimum displacement body size, as an ATR(14) multiple
input double InpDisplacementCloseLocationPct  = 0.70; // Minimum directional close-location-in-range ratio (0..1)

input group "=== Sequence Control ==="
input int    InpSequenceTimeoutBars      = 24;      // Max M5 bars an in-flight setup may stay unresolved before invalidation

input group "=== Spread Guard ==="
input double InpMaxSpreadPoints          = 500;     // Maximum allowed spread, in broker points (tune per broker's XAUUSD point size)

input group "=== Execution ==="
input int    InpMaxSlippagePoints        = 20;      // Maximum allowed deviation, in broker points

input group "=== Session Filter (broker/server time hours, research segmentation) ==="
input ENUM_G01_SESSION InpAllowedSession = SESSION_ALL; // SESSION_ALL = baseline testing mode (no session restriction)
input int    InpAsiaStartHour            = 22;      // Asia session start hour (wraps past midnight)
input int    InpAsiaEndHour              = 7;       // Asia session end hour
input int    InpLondonStartHour          = 7;       // London session start hour
input int    InpLondonEndHour            = 12;      // London session end hour
input int    InpOverlapStartHour         = 12;       // London/NY overlap start hour
input int    InpOverlapEndHour           = 16;       // London/NY overlap end hour
input int    InpNYStartHour              = 12;       // New York session start hour
input int    InpNYEndHour                = 21;       // New York session end hour

input group "=== News Filter (out of scope for v0.1 -- kept OFF for the raw baseline) ==="
input bool   InpEnableNewsFilter         = false;   // Baseline: OFF. Reserved for a future sprint's calendar-based filter.

input group "=== Research Telemetry ==="
input bool   InpEnableCSVLogging         = true;               // Write one CSV row per closed trade to Files\Common
input string InpCSVFileName              = "AT24_G01_ResearchLog.csv"; // CSV file name (written via FILE_COMMON)

//========================== GLOBAL STATE ==============================

CTrade            g_trade;
ENUM_G01_STATE    g_state = STATE_IDLE;
SCaseData         g_case;
SSymbolSpec       g_symbolSpec;

SSwingPoint       g_m15Highs[];
SSwingPoint       g_m15Lows[];
SSwingPoint       g_m5Highs[];
SSwingPoint       g_m5Lows[];

datetime          g_lastM15Time = 0;
datetime          g_lastM5Time  = 0;

int               g_dailyTradeCount = 0;
datetime          g_dailyCounterDay = 0;

//--- Deferred CSV row: filled at entry, written once the position's outcome is known.
struct SPendingCSVRow
  {
   bool            active;
   datetime        timestamp;
   string          symbol;
   SLiquidityLevel liquidity;
   SSweepEvent     sweep;
   double          atr;
   double          displacement_ratio;
   double          mss_price;
   SFVGEvent       fvg;
   double          entry;
   double          sl;
   double          tp;
   double          risk_percent;
   ENUM_G01_SESSION session;
   double          spread;
   double          risk_price_distance;
   ulong           position_ticket;
  };
SPendingCSVRow g_pendingRow;

//========================== HELPERS (execution/adapter layer) =========

int G01_BarsBetween(datetime t1,datetime t2)
  {
   int secs = PeriodSeconds(PERIOD_M5);
   if(secs <= 0)
      return(0);
   return((int)((t2 - t1) / secs));
  }

bool G01_HasOpenPosition(const string symbol,long magic)
  {
   for(int i=PositionsTotal()-1; i>=0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == symbol &&
         (long)PositionGetInteger(POSITION_MAGIC) == magic)
         return(true);
     }
   return(false);
  }

ulong G01_FindOpenPositionTicket(const string symbol,long magic)
  {
   for(int i=PositionsTotal()-1; i>=0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      if(PositionGetString(POSITION_SYMBOL) == symbol &&
         (long)PositionGetInteger(POSITION_MAGIC) == magic)
         return(ticket);
     }
   return(0);
  }

//--- Build the current prioritized liquidity level list (adapter fetch + pure assembly).
int G01_BuildLiquidityLevels(double atrValue,SLiquidityLevel &levels[])
  {
   SBar prevDay,prevWeek;
   bool haveDay  = G01_FetchPrevDailyBar(_Symbol,prevDay);
   bool haveWeek = G01_FetchPrevWeeklyBar(_Symbol,prevWeek);
   double eqTolerance = atrValue * InpEqualLevelATRTolerance;
   return(G01_AssembleLiquidityLevels(prevDay,haveDay,prevWeek,haveWeek,
                                       g_m15Highs,g_m15Lows,eqTolerance,levels));
  }

//--- Scan the priority-ordered liquidity list for a sweep on the given closed M5 candle.
//--- First (highest-priority) match wins.
bool G01_TryDetectSweepAcrossLevels(const SLiquidityLevel &levels[],const SBar &candle,
                                     double atrValue,datetime barTime)
  {
   for(int i=0; i<ArraySize(levels); i++)
     {
      SSweepEvent ev;
      if(G01_DetectSweep(levels[i],candle,atrValue,InpMinSweepPenetrationATR,ev))
        {
         g_case.liquidity       = levels[i];
         g_case.sweep           = ev;
         g_case.case_start_time = barTime;
         MqlDateTime dt; TimeToStruct(barTime,dt);
         g_case.session = G01_ClassifySessionFromHour(dt.hour,
                              InpAsiaStartHour,InpAsiaEndHour,
                              InpLondonStartHour,InpLondonEndHour,
                              InpOverlapStartHour,InpOverlapEndHour,
                              InpNYStartHour,InpNYEndHour);
         G01_LogEvent("SWEEP",StringFormat("type=%s level=%.5f dir=%s pen_atr=%.2f",
                       G01_LiquidityTypeToString(levels[i].type),levels[i].price,
                       G01_DirectionToString(ev.direction),ev.penetration_atr));
         G01_TransitionTo(g_state,STATE_SWEEP_CONFIRMED);
         return(true);
        }
     }
   return(false);
  }

//--- Invalidate the in-flight case if a fresh sweep in the OPPOSITE direction occurs.
bool G01_CheckOpposingSweep(const SBar &candle,double atrValue)
  {
   SLiquidityLevel levels[];
   G01_BuildLiquidityLevels(atrValue,levels);
   ENUM_G01_DIRECTION opposite = (g_case.sweep.direction == DIR_BULLISH) ? DIR_BEARISH : DIR_BULLISH;
   for(int i=0; i<ArraySize(levels); i++)
     {
      SSweepEvent ev;
      if(G01_DetectSweep(levels[i],candle,atrValue,InpMinSweepPenetrationATR,ev) && ev.direction == opposite)
        {
         G01_InvalidateCase(g_state,g_case,INVALID_OPPOSING_SWEEP,
                             StringFormat("type=%s level=%.5f",
                             G01_LiquidityTypeToString(levels[i].type),levels[i].price));
         return(true);
        }
     }
   return(false);
  }

//--- Invalidate the in-flight case if structure shifts against it (opposing MSS).
bool G01_CheckOpposingMSS(const SBar &candle)
  {
   ENUM_G01_DIRECTION opposite = (g_case.sweep.direction == DIR_BULLISH) ? DIR_BEARISH : DIR_BULLISH;
   SMSSEvent m;
   if(G01_DetectMSS(opposite,candle,g_m5Highs,g_m5Lows,m))
     {
      G01_InvalidateCase(g_state,g_case,INVALID_OPPOSING_MSS,
                          StringFormat("broken=%.5f close=%.5f",m.broken_swing_price,m.mss_close));
      return(true);
     }
   return(false);
  }

//========================== SEQUENCE ORCHESTRATION =====================
//--- Called exactly once per newly CLOSED M5 bar. Drives the state machine forward through
//--- LIQUIDITY -> SWEEP -> DISPLACEMENT -> MSS -> FVG -> WAITING_RETEST in strict order.
void G01_ProcessNewM5Bar(datetime barTime)
  {
   G01_UpdateDailyCounter(barTime,g_dailyCounterDay,g_dailyTradeCount);

   if(g_state != STATE_IDLE)
     {
      int barsElapsed = G01_BarsBetween(g_case.case_start_time,barTime);
      if(g_case.case_start_time > 0 && barsElapsed > InpSequenceTimeoutBars)
        {
         G01_InvalidateCase(g_state,g_case,INVALID_SEQUENCE_TIMEOUT,
                             StringFormat("bars_elapsed=%d",barsElapsed));
         return;
        }
     }

   bool atrOk;
   double atr = G01_GetATR(1,atrOk);
   if(!atrOk || atr <= 0.0)
      return;

   SBar candle;
   if(!G01_FetchBar(_Symbol,PERIOD_M5,1,candle))
      return;

   //--- STATE_IDLE: look for a fresh liquidity reference, then try a same-bar sweep.
   if(g_state == STATE_IDLE)
     {
      if(g_dailyTradeCount >= InpMaxTradesPerDay || G01_HasOpenPosition(_Symbol,InpMagicNumber))
         return;

      SLiquidityLevel levels[];
      if(G01_BuildLiquidityLevels(atr,levels) == 0)
         return;

      G01_TransitionTo(g_state,STATE_LIQUIDITY_IDENTIFIED);
      G01_TryDetectSweepAcrossLevels(levels,candle,atr,barTime);
      return;
     }

   //--- STATE_LIQUIDITY_IDENTIFIED: keep watching for a sweep against the current reference set.
   if(g_state == STATE_LIQUIDITY_IDENTIFIED)
     {
      if(g_dailyTradeCount >= InpMaxTradesPerDay || G01_HasOpenPosition(_Symbol,InpMagicNumber))
        {
         G01_InvalidateCase(g_state,g_case,INVALID_DAILY_LIMIT_REACHED,"blocked_before_sweep");
         return;
        }
      SLiquidityLevel levels[];
      if(G01_BuildLiquidityLevels(atr,levels) == 0)
        {
         G01_InvalidateCase(g_state,g_case,INVALID_LIQUIDITY_STALE,"no_valid_levels");
         return;
        }
      G01_TryDetectSweepAcrossLevels(levels,candle,atr,barTime);
      return;
     }

   //--- STATE_SWEEP_CONFIRMED: wait for an objective displacement candle in the sweep's direction.
   if(g_state == STATE_SWEEP_CONFIRMED)
     {
      if(G01_CheckOpposingSweep(candle,atr))
         return;
      SDisplacementEvent d;
      if(G01_CalculateDisplacement(candle,atr,InpDisplacementBodyATRMultiple,
                                    InpDisplacementCloseLocationPct,g_case.sweep.direction,d))
        {
         g_case.displacement = d;
         G01_LogEvent("DISPLACEMENT",StringFormat("dir=%s body_atr=%.2f close_loc=%.2f",
                       G01_DirectionToString(d.direction),d.body_atr_ratio,d.close_location_ratio));
         G01_TransitionTo(g_state,STATE_DISPLACEMENT_CONFIRMED);
        }
      return;
     }

   //--- STATE_DISPLACEMENT_CONFIRMED: wait for a confirmed-close Market Structure Shift.
   if(g_state == STATE_DISPLACEMENT_CONFIRMED)
     {
      if(G01_CheckOpposingSweep(candle,atr))
         return;
      SMSSEvent m;
      if(G01_DetectMSS(g_case.sweep.direction,candle,g_m5Highs,g_m5Lows,m))
        {
         g_case.mss = m;
         G01_LogEvent("MSS",StringFormat("dir=%s broken=%.5f close=%.5f",
                       G01_DirectionToString(m.direction),m.broken_swing_price,m.mss_close));
         G01_TransitionTo(g_state,STATE_MSS_CONFIRMED);
         return;
        }
      G01_CheckOpposingMSS(candle);
      return;
     }

   //--- STATE_MSS_CONFIRMED: search for a same-direction FVG formed at/after the MSS.
   if(g_state == STATE_MSS_CONFIRMED)
     {
      SBar candle1,candle3;
      if(!G01_FetchBar(_Symbol,PERIOD_M5,3,candle1))
         return;
      candle3 = candle; // the bar just closed is candle3 of the 3-candle FVG window
      SFVGEvent f;
      if(G01_DetectFVG(candle1,candle3,atr,g_case.sweep.direction,g_case.mss.mss_candle_time,f))
        {
         g_case.fvg = f;
         G01_LogEvent("FVG",StringFormat("dir=%s upper=%.5f lower=%.5f size_atr=%.2f",
                       G01_DirectionToString(f.direction),f.upper,f.lower,f.size_atr));
         G01_TransitionTo(g_state,STATE_FVG_CONFIRMED);
         G01_TransitionTo(g_state,STATE_WAITING_RETEST);
        }
      return;
     }

   //--- STATE_WAITING_RETEST: invalidate if a closed candle fully mitigates the FVG.
   if(g_state == STATE_WAITING_RETEST)
     {
      if(G01_IsFVGInvalidatedByClose(g_case.fvg,candle))
         G01_InvalidateCase(g_state,g_case,INVALID_FVG_INVALIDATED_BY_CLOSE,
                             StringFormat("close=%.5f",candle.close));
      return;
     }
  }

//--- Called every tick while WAITING_RETEST: fires the market entry the instant price
//--- actually reaches the 50% FVG level. (Design note: a resting limit order at the FVG
//--- midpoint was considered and rejected for v0.1 in favour of this simpler, more directly
//--- auditable tick-monitoring approach -- see README "Entry Execution Design".)
void G01_CheckRetestAndEnter()
  {
   if(g_state != STATE_WAITING_RETEST)
      return;

   double bid = SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double entryLevel = G01_CalculateEntry(g_case.fvg);

   bool reached = false;
   if(g_case.fvg.direction == DIR_BULLISH && bid <= entryLevel)
      reached = true;
   else if(g_case.fvg.direction == DIR_BEARISH && ask >= entryLevel)
      reached = true;

   if(!reached)
      return;

   if(g_dailyTradeCount >= InpMaxTradesPerDay)
     {
      G01_InvalidateCase(g_state,g_case,INVALID_DAILY_LIMIT_REACHED,"at_entry");
      return;
     }
   if(G01_HasOpenPosition(_Symbol,InpMagicNumber))
     {
      G01_InvalidateCase(g_state,g_case,INVALID_MAX_POSITIONS_OPEN,"at_entry");
      return;
     }
   double currentSpread = (double)SymbolInfoInteger(_Symbol,SYMBOL_SPREAD);
   if(G01_IsSpreadBlocked(currentSpread,InpMaxSpreadPoints))
     {
      G01_InvalidateCase(g_state,g_case,INVALID_SPREAD_BLOCK,StringFormat("spread=%.0f",currentSpread));
      return;
     }
   if(G01_IsNewsBlocked(InpEnableNewsFilter))
     {
      G01_InvalidateCase(g_state,g_case,INVALID_SESSION_BLOCK,"news_block");
      return;
     }
   MqlDateTime dt; TimeToStruct(TimeCurrent(),dt);
   ENUM_G01_SESSION current = G01_ClassifySessionFromHour(dt.hour,
                                 InpAsiaStartHour,InpAsiaEndHour,
                                 InpLondonStartHour,InpLondonEndHour,
                                 InpOverlapStartHour,InpOverlapEndHour,
                                 InpNYStartHour,InpNYEndHour);
   if(!G01_IsSessionAllowed(current,InpAllowedSession))
     {
      G01_InvalidateCase(g_state,g_case,INVALID_SESSION_BLOCK,
                          StringFormat("session=%s allowed=%s",
                          G01_SessionToString(current),G01_SessionToString(InpAllowedSession)));
      return;
     }

   G01_ExecuteEntry(entryLevel,current,currentSpread);
  }

void G01_ExecuteEntry(double entryLevel,ENUM_G01_SESSION session,double currentSpread)
  {
   bool atrOk;
   double atr = G01_GetATR(1,atrOk);
   if(!atrOk || atr <= 0.0)
     {
      G01_InvalidateCase(g_state,g_case,INVALID_SEQUENCE_TIMEOUT,"atr_unavailable_at_entry");
      return;
     }

   double sl   = G01_CalculateSL(g_case.sweep,atr,InpSLBufferATRMultiple);
   double tp   = G01_CalculateTP(entryLevel,sl,InpTP_RMultiple);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double lots = G01_CalculateLotSize(InpRiskPercent,entryLevel,sl,equity,g_symbolSpec);

   if(lots <= 0.0)
     {
      G01_InvalidateCase(g_state,g_case,INVALID_SEQUENCE_TIMEOUT,"lot_size_invalid");
      return;
     }

   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(InpMaxSlippagePoints);

   bool sent;
   if(g_case.fvg.direction == DIR_BULLISH)
      sent = g_trade.Buy(lots,_Symbol,0.0,sl,tp,"AT24_G01");
   else
      sent = g_trade.Sell(lots,_Symbol,0.0,sl,tp,"AT24_G01");

   G01_LogEvent("ENTRY",StringFormat("dir=%s entry=%.5f sl=%.5f tp=%.5f lots=%.2f session=%s sent=%s",
                 G01_DirectionToString(g_case.fvg.direction),entryLevel,sl,tp,lots,
                 G01_SessionToString(session),sent ? "true" : "false"));

   if(sent)
     {
      g_dailyTradeCount++;
      ulong ticket = G01_FindOpenPositionTicket(_Symbol,InpMagicNumber);

      g_pendingRow.active              = true;
      g_pendingRow.timestamp           = TimeCurrent();
      g_pendingRow.symbol              = _Symbol;
      g_pendingRow.liquidity           = g_case.liquidity;
      g_pendingRow.sweep               = g_case.sweep;
      g_pendingRow.atr                 = atr;
      g_pendingRow.displacement_ratio  = g_case.displacement.body_atr_ratio;
      g_pendingRow.mss_price           = g_case.mss.broken_swing_price;
      g_pendingRow.fvg                 = g_case.fvg;
      g_pendingRow.entry               = entryLevel;
      g_pendingRow.sl                  = sl;
      g_pendingRow.tp                  = tp;
      g_pendingRow.risk_percent        = InpRiskPercent;
      g_pendingRow.session             = session;
      g_pendingRow.spread              = currentSpread;
      g_pendingRow.risk_price_distance = MathAbs(entryLevel - sl);
      g_pendingRow.position_ticket     = ticket;
     }

   G01_TransitionTo(g_state,STATE_ENTRY);
   ZeroMemory(g_case);
   G01_TransitionTo(g_state,STATE_IDLE);
  }

//========================== MQL5 EVENT HANDLERS =========================

int OnInit()
  {
   if(StringFind(_Symbol,"XAU") < 0 && StringFind(_Symbol,"GOLD") < 0)
      G01_LogEvent("INIT",StringFormat("WARNING: symbol '%s' does not look like a gold XAUUSD variant.",_Symbol));

   if(!G01_CreateATRHandle(_Symbol,PERIOD_M5,InpATRPeriod))
     {
      G01_LogEvent("INIT","FAILED to create ATR handle.");
      return(INIT_FAILED);
     }
   if(!G01_LoadSymbolSpec(_Symbol,g_symbolSpec))
     {
      G01_LogEvent("INIT","FAILED to load symbol trading spec (tick size/value).");
      return(INIT_FAILED);
     }

   g_trade.SetExpertMagicNumber(InpMagicNumber);
   g_trade.SetDeviationInPoints(InpMaxSlippagePoints);
   g_trade.SetTypeFillingBySymbol(_Symbol);

   g_state = STATE_IDLE;
   ZeroMemory(g_case);
   ZeroMemory(g_pendingRow);
   ArrayResize(g_m15Highs,0);
   ArrayResize(g_m15Lows,0);
   ArrayResize(g_m5Highs,0);
   ArrayResize(g_m5Lows,0);

   g_dailyCounterDay = TimeCurrent();
   g_dailyTradeCount = 0;

   if(InpEnableCSVLogging)
     {
      if(!G01_OpenCSV(InpCSVFileName))
         G01_LogEvent("INIT","WARNING: could not open CSV research log; continuing with Print logging only.");
     }

   G01_LogEvent("INIT",StringFormat("G01 initialized on %s, magic=%d",_Symbol,(int)InpMagicNumber));
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   G01_ReleaseATRHandle();
   G01_CloseCSV();
  }

void OnTick()
  {
   if(G01_IsNewBar(_Symbol,PERIOD_M15,g_lastM15Time))
     {
      SBar window[];
      if(G01_FetchBarWindow(_Symbol,PERIOD_M15,1,2*InpM15SwingLookback+1,window))
         G01_UpdateConfirmedSwings(window,InpM15SwingLookback,g_m15Highs,g_m15Lows);
     }

   if(G01_IsNewBar(_Symbol,PERIOD_M5,g_lastM5Time))
     {
      SBar window[];
      if(G01_FetchBarWindow(_Symbol,PERIOD_M5,1,2*InpM5SwingLookback+1,window))
         G01_UpdateConfirmedSwings(window,InpM5SwingLookback,g_m5Highs,g_m5Lows);

      SBar closedBar;
      if(G01_FetchBar(_Symbol,PERIOD_M5,1,closedBar))
         G01_ProcessNewM5Bar(closedBar.time);
     }

   G01_CheckRetestAndEnter();
  }

void OnTradeTransaction(const MqlTradeTransaction &trans,
                         const MqlTradeRequest &request,
                         const MqlTradeResult &result)
  {
   if(!g_pendingRow.active)
      return;
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;

   ulong dealTicket = trans.deal;
   if(!HistoryDealSelect(dealTicket))
      return;
   if((long)HistoryDealGetInteger(dealTicket,DEAL_MAGIC) != InpMagicNumber)
      return;
   if(HistoryDealGetString(dealTicket,DEAL_SYMBOL) != _Symbol)
      return;
   if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket,DEAL_ENTRY) != DEAL_ENTRY_OUT)
      return;

   double profit    = HistoryDealGetDouble(dealTicket,DEAL_PROFIT) +
                       HistoryDealGetDouble(dealTicket,DEAL_SWAP) +
                       HistoryDealGetDouble(dealTicket,DEAL_COMMISSION);
   double closePrice = HistoryDealGetDouble(dealTicket,DEAL_PRICE);
   ENUM_DEAL_REASON reasonRaw = (ENUM_DEAL_REASON)HistoryDealGetInteger(dealTicket,DEAL_REASON);

   string exitReason;
   switch(reasonRaw)
     {
      case DEAL_REASON_SL:     exitReason = "SL";     break;
      case DEAL_REASON_TP:     exitReason = "TP";     break;
      case DEAL_REASON_CLIENT: exitReason = "MANUAL";  break;
      case DEAL_REASON_EXPERT: exitReason = "EXPERT";  break;
      case DEAL_REASON_SO:     exitReason = "STOPOUT"; break;
      default:                 exitReason = "OTHER";   break;
     }

   double signedRisk = g_pendingRow.entry - g_pendingRow.sl;
   double rMultiple  = (signedRisk != 0.0) ? (closePrice - g_pendingRow.entry) / signedRisk : 0.0;
   string result_s   = (profit >= 0.0) ? "WIN" : "LOSS";

   if(InpEnableCSVLogging)
      G01_WriteTradeCSV(g_symbolSpec.digits,g_pendingRow.timestamp,g_pendingRow.symbol,
                         g_pendingRow.liquidity,g_pendingRow.sweep,g_pendingRow.atr,
                         g_pendingRow.displacement_ratio,g_pendingRow.mss_price,g_pendingRow.fvg,
                         g_pendingRow.entry,g_pendingRow.sl,g_pendingRow.tp,g_pendingRow.risk_percent,
                         g_pendingRow.session,g_pendingRow.spread,result_s,rMultiple,exitReason);

   G01_LogEvent("CLOSE",StringFormat("ticket=%s result=%s profit=%.2f R=%.2f reason=%s",
                 (string)g_pendingRow.position_ticket,result_s,profit,rMultiple,exitReason));

   g_pendingRow.active = false;
  }
//+------------------------------------------------------------------+
