//+------------------------------------------------------------------+
//| AT24_TP_Core.mqh                                                 |
//| Trade planner maths: from entry, stop and target prices and the  |
//| account risk rules to lots, money at risk / reward, R:R, costs   |
//| and the share of the remaining daily loss limit this trade uses. |
//| Pure maths (platform values are passed in). Builds on the        |
//| verified Position Size core.                                     |
//+------------------------------------------------------------------+
#ifndef AT24_TP_CORE_MQH
#define AT24_TP_CORE_MQH

#include "AT24_PS_Core.mqh"

struct AT24TP_Plan
  {
   int    dir;            // +1 long (target above entry), -1 short, 0 invalid
   bool   linesOk;        // stop on the opposite side of the target and both away from the entry
   double slDist;         // price units
   double tpDist;
   double rr;             // reward / risk (price distances)
   double lots;           // rounded down to the volume step, within limits (0 when even the minimum lot is too big)
   double riskMoney;      // loss at the stop with these lots (account currency), without costs
   double rewardMoney;    // profit at the target with these lots, without costs
   double spreadCost;     // spread paid on entry for these lots
   double commission;     // round-turn commission for these lots
   double costShare;      // (spread + commission) as % of the reward
   double dailyShare;     // risk + costs as % of the remaining daily loss allowance (0 when no allowance given)
   bool   tooSmall;
   bool   capped;
  };

//--- riskMoney: money to risk (balance x risk %); dailyAllowance: remaining daily loss allowance in money (0 = not used)
void AT24TP_Plan_Calc(const double entry, const double sl, const double tp, const double riskMoney,
                      const double tickSize, const double tickValue, const double volMin, const double volMax, const double volStep,
                      const double spreadPrice, const double commissionPerLot, const double dailyAllowance, AT24TP_Plan &p)
  {
   p.dir = 0; p.linesOk = false; p.slDist = 0.0; p.tpDist = 0.0; p.rr = 0.0; p.lots = 0.0; p.riskMoney = 0.0; p.rewardMoney = 0.0;
   p.spreadCost = 0.0; p.commission = 0.0; p.costShare = 0.0; p.dailyShare = 0.0; p.tooSmall = false; p.capped = false;
   if(tp > entry) p.dir = 1; else if(tp < entry) p.dir = -1;
   if(p.dir == 0) return;
   p.slDist = p.dir * (entry - sl);        // positive when the stop is on the losing side
   p.tpDist = p.dir * (tp - entry);
   p.linesOk = (p.slDist > 0.0 && p.tpDist > 0.0);
   if(!p.linesOk) return;
   p.rr = p.tpDist / p.slDist;
   AT24PS_Result r; AT24PS_Size(riskMoney, p.slDist, tickSize, tickValue, volMin, volMax, volStep, r);
   p.tooSmall = r.tooSmall; p.capped = r.capped; p.lots = r.lots;
   if(r.lots <= 0.0) return;
   p.riskMoney = r.riskAtLots;
   p.rewardMoney = r.lots * AT24PS_LossPerLot(p.tpDist, tickSize, tickValue);
   p.spreadCost = r.lots * AT24PS_LossPerLot(spreadPrice, tickSize, tickValue);
   p.commission = r.lots * commissionPerLot;
   double cost = p.spreadCost + p.commission;
   p.costShare = p.rewardMoney > 0.0 ? 100.0 * cost / p.rewardMoney : 0.0;
   p.dailyShare = dailyAllowance > 0.0 ? 100.0 * (p.riskMoney + cost) / dailyAllowance : 0.0;
  }

#endif // AT24_TP_CORE_MQH
