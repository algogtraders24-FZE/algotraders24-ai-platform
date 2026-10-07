//+------------------------------------------------------------------+
//| AT24_Copier_RxLock.mqh - "one Receiver per channel" guard        |
//| Two Receivers on the same terminal and channel would each open a |
//| copy of every master trade (found in the live MT4 test: a        |
//| terminal had saved the EA onto several charts). The first one    |
//| keeps a heartbeat in a terminal global variable; any other one   |
//| sees it and does nothing until the owner has been silent >5 s.   |
//| Shared by the MT4 and MT5 Receivers.                             |
//+------------------------------------------------------------------+
#ifndef AT24_COPIER_RXLOCK_MQH
#define AT24_COPIER_RXLOCK_MQH

int  g_rxLockCycles = 0;      // consecutive cycles in which this instance has held the lock
long g_rxLockOther  = 0;      // tag of the instance that blocks us (for the status line)

string AT24C_RxLockName(const string chan)
  {
   return "AT24C_" + chan + "_RXLOCK";
  }

//--- value = ownerTag * 1e10 + heartbeat (local seconds); exactly representable in a double
//--- Returns true only when this instance is the established owner (held for 2 consecutive cycles,
//--- so two instances that start in the same instant sort themselves out before any order is sent).
bool AT24C_RxLockAcquire(const string chan)
  {
   string name = AT24C_RxLockName(chan);
   double tag  = (double)((long)ChartID() % 100000) + 1.0;
   double now  = (double)(long)TimeLocal();
   if(GlobalVariableCheck(name))
     {
      double v    = GlobalVariableGet(name);
      double otag = MathFloor(v / 1e10);
      double ot   = v - otag * 1e10;
      if(otag != tag && now - ot <= 5.0)
        {
         g_rxLockCycles = 0;
         g_rxLockOther  = (long)otag;
         return false;
        }
     }
   GlobalVariableSet(name, tag * 1e10 + now);
   g_rxLockCycles++;
   return g_rxLockCycles >= 2;
  }

void AT24C_RxLockRelease(const string chan)
  {
   string name = AT24C_RxLockName(chan);
   if(!GlobalVariableCheck(name))
      return;
   double tag = (double)((long)ChartID() % 100000) + 1.0;
   if(MathFloor(GlobalVariableGet(name) / 1e10) == tag)
      GlobalVariableDel(name);
  }

#endif // AT24_COPIER_RXLOCK_MQH
