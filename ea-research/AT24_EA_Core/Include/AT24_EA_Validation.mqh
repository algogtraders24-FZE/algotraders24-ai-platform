//+------------------------------------------------------------------+
//| AT24_EA_Validation.mqh                                           |
//| Strategy-Tester validation helpers (MQL5 book, Part 6 Tester):   |
//|  - AT24_OnTesterScore(): custom optimization criterion that      |
//|    prefers stable, low-drawdown parameter sets over lucky ones   |
//|  - Frames: every optimization pass sends a stats record from the |
//|    agent; the terminal collects them into one CSV report.        |
//|                                                                  |
//| Usage in an EA (does not touch trading logic):                   |
//|   #include "AT24_EA_Validation.mqh"                              |
//| then pick "Custom max" as the optimization criterion.            |
//| Report: <Terminal Common>\Files\AT24_optimization_report.csv     |
//+------------------------------------------------------------------+
#ifndef AT24_EA_VALIDATION_MQH
#define AT24_EA_VALIDATION_MQH

#ifndef AT24_MIN_TRADES
#define AT24_MIN_TRADES 30      // below this a pass is not statistically meaningful
#endif
#ifndef AT24_REPORT_FILE
#define AT24_REPORT_FILE "AT24_optimization_report.csv"
#endif

//--- Score = recovery-style ratio * capped profit factor * sqrt(trade count).
//--- Losing passes return their (negative) net profit so they always rank last.
double AT24_OnTesterScore()
  {
   const double profit  = TesterStatistics(STAT_PROFIT);
   const double trades  = TesterStatistics(STAT_TRADES);
   const double pf      = TesterStatistics(STAT_PROFIT_FACTOR);
   const double eqDD    = TesterStatistics(STAT_EQUITY_DDREL_PERCENT); // percent of peak
   const double deposit = TesterStatistics(STAT_INITIAL_DEPOSIT);

   if(trades < AT24_MIN_TRADES)
      return 0.0;
   if(profit <= 0.0)
      return profit;

   const double dd = MathMax(eqDD, 1.0);                 // floor 1% so a lucky tiny DD cannot explode the score
   const double returnPct = (deposit > 0.0) ? profit / deposit * 100.0 : profit;
   const double score = (returnPct / dd) * MathMin(pf, 3.0) * MathSqrt(MathMin(trades, 400.0));
   return MathIsValidNumber(score) ? score : 0.0;
  }

//--- Agent side: called at the end of every pass (single run too).
double OnTester()
  {
   const double score = AT24_OnTesterScore();
   if(MQLInfoInteger(MQL_OPTIMIZATION))
     {
      double stats[8];
      stats[0] = TesterStatistics(STAT_PROFIT);
      stats[1] = TesterStatistics(STAT_PROFIT_FACTOR);
      stats[2] = TesterStatistics(STAT_TRADES);
      stats[3] = TesterStatistics(STAT_EQUITY_DDREL_PERCENT);
      stats[4] = TesterStatistics(STAT_BALANCE_DDREL_PERCENT);
      stats[5] = TesterStatistics(STAT_SHARPE_RATIO);
      stats[6] = TesterStatistics(STAT_RECOVERY_FACTOR);
      stats[7] = score;
      FrameAdd("at24stats", 1, 0.0, stats);
     }
   return score;
  }

//--- Terminal side: create the CSV with a header when optimization starts.
void OnTesterInit()
  {
   int h = FileOpen(AT24_REPORT_FILE, FILE_WRITE | FILE_CSV | FILE_COMMON | FILE_ANSI, ',');
   if(h == INVALID_HANDLE)
     { Print("AT24 validation: cannot create ", AT24_REPORT_FILE, " err=", GetLastError()); return; }
   FileWrite(h, "pass", "net_profit", "profit_factor", "trades", "equity_dd_pct", "balance_dd_pct", "sharpe", "recovery_factor", "at24_score", "inputs");
   FileClose(h);
  }

//--- Terminal side: append one row per finished pass.
void OnTesterPass()
  {
   ulong  pass;
   string name;
   long   id;
   double val;
   double stats[];
   while(FrameNext(pass, name, id, val, stats))
     {
      if(name != "at24stats" || ArraySize(stats) < 8)
         continue;
      string params[];
      uint   cnt = 0;
      string inputs = "";
      if(FrameInputs(pass, params, cnt))
        {
         for(uint i = 0; i < cnt; i++)
            inputs += params[i] + (i + 1 < cnt ? ";" : "");
        }
      int h = FileOpen(AT24_REPORT_FILE, FILE_READ | FILE_WRITE | FILE_CSV | FILE_COMMON | FILE_ANSI, ',');
      if(h == INVALID_HANDLE)
         continue;
      FileSeek(h, 0, SEEK_END);
      FileWrite(h, (string)pass, DoubleToString(stats[0], 2), DoubleToString(stats[1], 2), (string)(long)stats[2],
                DoubleToString(stats[3], 2), DoubleToString(stats[4], 2), DoubleToString(stats[5], 2),
                DoubleToString(stats[6], 2), DoubleToString(stats[7], 4), inputs);
      FileClose(h);
     }
  }

void OnTesterDeinit()
  {
   Print("AT24 validation: optimization finished, report: Common\\Files\\", AT24_REPORT_FILE);
  }

#endif // AT24_EA_VALIDATION_MQH
