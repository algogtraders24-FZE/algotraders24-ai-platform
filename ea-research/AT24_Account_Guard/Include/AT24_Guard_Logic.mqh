//+------------------------------------------------------------------+
//| AT24_Guard_Logic.mqh                                             |
//| PURE decision logic for the AT24 Account Guard: takes numbers,   |
//| returns which limit (if any) is breached. No terminal calls, so  |
//| it can be unit-tested and ported to MT4 unchanged.               |
//+------------------------------------------------------------------+
#ifndef AT24_GUARD_LOGIC_MQH
#define AT24_GUARD_LOGIC_MQH

enum ENUM_GUARD_BREACH
  {
   GUARD_OK = 0,
   GUARD_DAILY_LOSS,      // equity fell too far below the day's baseline   -> lock until next day
   GUARD_MAX_DRAWDOWN,    // equity fell too far below its peak              -> lock until manually cleared
   GUARD_DAILY_PROFIT,    // daily profit target reached                     -> lock until next day
   GUARD_MARGIN_LEVEL     // margin level too low while positions are open   -> close, lock until next day
  };

struct SGuardLimits
  {
   double daily_loss_pct;       // 0 = off
   double max_drawdown_pct;     // 0 = off (from peak equity)
   double daily_profit_pct;     // 0 = off
   double min_margin_level_pct; // 0 = off
  };

struct SGuardState
  {
   double day_base;     // balance or equity at the start of the day
   double peak_equity;  // highest equity seen since the last full reset
  };

//--- Returns the first breached limit in priority order (hard stops before the profit target).
ENUM_GUARD_BREACH Guard_Evaluate(const SGuardLimits &lim, const SGuardState &st,
                                 const double equity, const double margin_level,
                                 const bool has_positions)
  {
   if(!MathIsValidNumber(equity) || equity <= 0.0)
      return GUARD_OK;                                   // never act on garbage input

   if(lim.max_drawdown_pct > 0.0 && st.peak_equity > 0.0)
     {
      double dd = (st.peak_equity - equity) / st.peak_equity * 100.0;
      if(dd >= lim.max_drawdown_pct)
         return GUARD_MAX_DRAWDOWN;
     }
   if(lim.daily_loss_pct > 0.0 && st.day_base > 0.0)
     {
      double loss = (st.day_base - equity) / st.day_base * 100.0;
      if(loss >= lim.daily_loss_pct)
         return GUARD_DAILY_LOSS;
     }
   if(lim.min_margin_level_pct > 0.0 && has_positions && margin_level > 0.0 && margin_level < lim.min_margin_level_pct)
      return GUARD_MARGIN_LEVEL;
   if(lim.daily_profit_pct > 0.0 && st.day_base > 0.0)
     {
      double gain = (equity - st.day_base) / st.day_base * 100.0;
      if(gain >= lim.daily_profit_pct)
         return GUARD_DAILY_PROFIT;
     }
   return GUARD_OK;
  }

//--- Only a max-drawdown breach is a permanent lock; everything else clears at the next day roll.
bool Guard_IsPermanent(const ENUM_GUARD_BREACH b)
  {
   return b == GUARD_MAX_DRAWDOWN;
  }

string Guard_Text(const ENUM_GUARD_BREACH b)
  {
   switch(b)
     {
      case GUARD_DAILY_LOSS:   return "daily loss limit";
      case GUARD_MAX_DRAWDOWN: return "max drawdown from peak";
      case GUARD_DAILY_PROFIT: return "daily profit target";
      case GUARD_MARGIN_LEVEL: return "minimum margin level";
      default:                 return "ok";
     }
  }

#endif // AT24_GUARD_LOGIC_MQH
