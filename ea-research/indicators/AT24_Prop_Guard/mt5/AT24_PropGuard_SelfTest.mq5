#include "AT24_PropGuard_Core.mqh"
int pass = 0, fail = 0;
void Check(const string name, const bool ok, const string detail = "")
  {
   if(ok) pass++; else fail++;
   PrintFormat("PGTEST %s %s %s", ok ? "PASS" : "FAIL", name, detail);
  }
bool Near(const double a, const double b, const double tol = 0.005) { return MathAbs(a - b) <= tol; }
void OnStart()
  {
   //--- 1. pure maths, synthetic scenarios
   double o[];
   AT24PG_Calc(10000, 9700, 10000, 5, 10, 10, o);
   Check("daily limit", Near(o[0], 500)); Check("daily pnl", Near(o[1], -300)); Check("daily left", Near(o[2], 200));
   Check("daily used 60%", Near(o[3], 0.6)); Check("status caution", AT24PG_Status(o[3]) == 2);
   AT24PG_Calc(10000, 9500, 10000, 5, 10, 10, o);
   Check("breach used 100%", Near(o[3], 1.0)); Check("status limit reached", AT24PG_Status(o[3]) == 4);
   AT24PG_Calc(10000, 10200, 10000, 5, 10, 10, o);
   Check("profit clips used to 0", Near(o[3], 0.0)); Check("daily left grows with profit", Near(o[2], 700));
   Check("target progress 200 of 1000", Near(o[7], 0.2, 0.0001), "value=" + DoubleToString(o[7], 4));
   AT24PG_Calc(10000, 9100, 10000, 5, 10, 10, o);
   Check("total left 100", Near(o[5], 100)); Check("total used 90%", Near(o[6], 0.9)); Check("status danger", AT24PG_Status(o[6]) == 3);
   MqlDateTime m;
   m.year = 2026; m.mon = 11; m.day = 2; m.hour = 16; m.min = 59; m.sec = 0; m.day_of_week = 0; m.day_of_year = 0;
   Check("daykey reset 17, 16:59 -> previous day", AT24PG_DayKey(StructToTime(m), 17) == 20261101);
   m.hour = 17; m.min = 0;
   Check("daykey reset 17, 17:00 -> same day", AT24PG_DayKey(StructToTime(m), 17) == 20261102);
   Check("daystart reset 17", AT24PG_DayStart(StructToTime(m), 17) == StructToTime(m));
   int cw = 0; while((AccountInfoInteger(ACCOUNT_LOGIN) == 0 || AccountInfoDouble(ACCOUNT_BALANCE) <= 0.0) && cw < 80) { Sleep(500); cw++; }
   GlobalVariableDel("AT24PG_" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + "_init");
   PrintFormat("PGTEST info waitedForAccount=%.1fs login=%d connected=%d", cw * 0.5, (int)AccountInfoInteger(ACCOUNT_LOGIN), (int)TerminalInfoInteger(TERMINAL_CONNECTED));
   //--- 2. indicator buffers on the live demo account vs independent calculation
   int h = iCustom(_Symbol, PERIOD_M5, "AT24Indicators\\AT24_Prop_Guard");
   int w = 0; while(BarsCalculated(h) <= 0 && w < 30) { Sleep(500); w++; }
   Sleep(1500);
   double b0[1], b1[1], b2[1], b3[1], b4[1];
   int n = CopyBuffer(h, 0, 0, 1, b0) + CopyBuffer(h, 1, 0, 1, b1) + CopyBuffer(h, 2, 0, 1, b2) + CopyBuffer(h, 3, 0, 1, b3) + CopyBuffer(h, 4, 0, 1, b4);
   Check("buffers readable", n == 5, "n=" + IntegerToString(n));
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   datetime ds = AT24PG_DayStart(TimeCurrent(), 0);
   double sum = 0;
   if(HistorySelect(ds, TimeCurrent() + 86400))
      for(int i = 0; i < HistoryDealsTotal(); i++)
        { ulong tk = HistoryDealGetTicket(i); sum += HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION) + HistoryDealGetDouble(tk, DEAL_FEE); }
   double base = bal - sum;
   double init = GlobalVariableGet("AT24PG_" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + "_init");
   double e[];
   AT24PG_Calc(base, eq, init, 5, 10, 10, e);
   PrintFormat("PGTEST info balance=%.2f equity=%.2f dealsToday=%.2f dayBase=%.2f initial=%.2f positions=%d", bal, eq, sum, base, init, PositionsTotal());
   Check("daily used % matches", Near(b0[0], e[3] * 100.0, 0.05), StringFormat("ind=%.3f exp=%.3f", b0[0], e[3] * 100.0));
   Check("total used % matches", Near(b1[0], e[6] * 100.0, 0.05), StringFormat("ind=%.3f exp=%.3f", b1[0], e[6] * 100.0));
   Check("daily left $ matches", Near(b2[0], e[2], 0.5), StringFormat("ind=%.2f exp=%.2f", b2[0], e[2]));
   Check("total left $ matches", Near(b3[0], e[5], 0.5), StringFormat("ind=%.2f exp=%.2f", b3[0], e[5]));
   Check("open risk is 0 with no positions", PositionsTotal() > 0 || Near(b4[0], 0.0), StringFormat("ind=%.2f", b4[0]));
   PrintFormat("PGTEST summary pass=%d fail=%d", pass, fail);
   Sleep(500);
  }

