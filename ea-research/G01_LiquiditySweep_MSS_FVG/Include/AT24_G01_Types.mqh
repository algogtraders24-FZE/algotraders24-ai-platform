//+------------------------------------------------------------------+
//| AT24_G01_Types.mqh                                                 |
//| Shared enums/structs for G01 Liquidity Sweep + MSS + FVG research  |
//|                                                                      |
//| PORTABILITY: everything in this file is plain data (no platform    |
//| API calls). SBar is the universal bar type used by every pure      |
//| strategy-logic module so those modules never touch MQL5-specific   |
//| functions directly -- only the platform adapter (Utils.mqh + the   |
//| main .mq5) fills SBar from CopyRates(). Porting to MT4 means        |
//| rewriting the adapter only; the structs and the modules that       |
//| consume them are unchanged.                                        |
//+------------------------------------------------------------------+
#ifndef AT24_G01_TYPES_MQH
#define AT24_G01_TYPES_MQH

//--- Deterministic state machine states (see StateMachine.mqh / README)
enum ENUM_G01_STATE
  {
   STATE_IDLE = 0,
   STATE_LIQUIDITY_IDENTIFIED,
   STATE_SWEEP_CONFIRMED,
   STATE_DISPLACEMENT_CONFIRMED,
   STATE_MSS_CONFIRMED,
   STATE_FVG_CONFIRMED,
   STATE_WAITING_RETEST,
   STATE_ENTRY,
   STATE_INVALIDATED
  };

enum ENUM_G01_LIQUIDITY_TYPE
  {
   LIQ_NONE = 0,
   LIQ_PDH,
   LIQ_PDL,
   LIQ_PWH,
   LIQ_PWL,
   LIQ_EQH,
   LIQ_EQL,
   LIQ_SWING_HIGH_M15,
   LIQ_SWING_LOW_M15
  };

enum ENUM_G01_DIRECTION
  {
   DIR_NONE = 0,
   DIR_BULLISH,
   DIR_BEARISH
  };

enum ENUM_G01_SESSION
  {
   SESSION_ALL = 0,
   SESSION_ASIA,
   SESSION_LONDON,
   SESSION_LONDON_NY_OVERLAP,
   SESSION_NEW_YORK,
   SESSION_OUTSIDE
  };

enum ENUM_G01_INVALIDATION_REASON
  {
   INVALID_NONE = 0,
   INVALID_SEQUENCE_TIMEOUT,
   INVALID_OPPOSING_SWEEP,
   INVALID_OPPOSING_MSS,
   INVALID_FVG_INVALIDATED_BY_CLOSE,
   INVALID_SPREAD_BLOCK,
   INVALID_SESSION_BLOCK,
   INVALID_DAILY_LIMIT_REACHED,
   INVALID_MAX_POSITIONS_OPEN,
   INVALID_LIQUIDITY_STALE
  };

//--- Universal plain-bar type. The ONLY bar representation the pure
//--- strategy modules understand. Adapter code converts MqlRates (MT5)
//--- or iOpen/iHigh/iLow/iClose (MT4) into this.
struct SBar
  {
   datetime time;
   double   open;
   double   high;
   double   low;
   double   close;
  };

//--- A detected liquidity level (PDH/PDL/PWH/PWL/EQH/EQL/M15 swing)
struct SLiquidityLevel
  {
   ENUM_G01_LIQUIDITY_TYPE type;
   double                  price;
   datetime                reference_time;
   bool                    valid;
  };

//--- A confirmed liquidity sweep on a closed M5 candle
struct SSweepEvent
  {
   ENUM_G01_LIQUIDITY_TYPE liquidity_type;
   double                  liquidity_price;
   ENUM_G01_DIRECTION      direction;
   datetime                candle_time;
   double                  candle_high;
   double                  candle_low;
   double                  candle_open;
   double                  candle_close;
   double                  penetration_price;
   double                  penetration_atr;
   double                  candle_range;
   double                  candle_body;
   double                  upper_wick;
   double                  lower_wick;
   double                  rejection_ratio;
   bool                    valid;
  };

//--- A confirmed displacement candle
struct SDisplacementEvent
  {
   ENUM_G01_DIRECTION direction;
   datetime           candle_time;
   double             body_size;
   double             atr_value;
   double             body_atr_ratio;
   double             close_location_ratio;
   bool               valid;
  };

//--- A confirmed market structure shift
struct SMSSEvent
  {
   ENUM_G01_DIRECTION direction;
   double             broken_swing_price;
   datetime           broken_swing_time;
   datetime           mss_candle_time;
   double             mss_close;
   double             break_distance;
   bool               valid;
  };

//--- A confirmed fair value gap
struct SFVGEvent
  {
   ENUM_G01_DIRECTION direction;
   datetime           creation_time;
   double             upper;
   double             lower;
   double             size_price;
   double             size_atr;
   bool               valid;
  };

//--- A confirmed swing point (used for both M15 liquidity swings and M5 MSS swings)
struct SSwingPoint
  {
   datetime time;
   double   price;
   bool     is_high;
   bool     valid;
  };

//--- Dynamically-read symbol trading properties (never hard-coded)
struct SSymbolSpec
  {
   int    digits;
   double point;
   double tick_size;
   double tick_value;
   double contract_size;
   double volume_min;
   double volume_max;
   double volume_step;
  };

//--- Working data for the single in-flight setup ("case") the state machine is tracking
struct SCaseData
  {
   SLiquidityLevel    liquidity;
   SSweepEvent        sweep;
   SDisplacementEvent displacement;
   SMSSEvent          mss;
   SFVGEvent          fvg;
   datetime           case_start_time;
   ENUM_G01_SESSION   session;
  };

#endif // AT24_G01_TYPES_MQH
