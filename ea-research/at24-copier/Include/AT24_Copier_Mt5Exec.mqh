//+------------------------------------------------------------------+
//| AT24_Copier_Mt5Exec.mqh - MT5-only order helpers                 |
//| Partial close through a raw OrderSend with fill-mode fallback.   |
//| (CTrade::PositionClosePartial returned false in a real hedging   |
//| demo terminal even for a valid request, so it is not relied on.) |
//+------------------------------------------------------------------+
#ifndef AT24_COPIER_MT5EXEC_MQH
#define AT24_COPIER_MT5EXEC_MQH

//--- Closes `vol` lots of a hedging position. Returns true only when the server accepted it.
bool AT24C_Mt5PartialClose(const ulong ticket, const double vol, const int deviation, uint &retcode, string &comment)
  {
   retcode = 0;
   comment = "";
   if(!PositionSelectByTicket(ticket))
     { comment = "position not found"; return false; }
   string sym  = PositionGetString(POSITION_SYMBOL);
   long   type = PositionGetInteger(POSITION_TYPE);
   long   magic = PositionGetInteger(POSITION_MAGIC);
   long   fm   = SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);

   ENUM_ORDER_TYPE_FILLING modes[3];
   int nm = 0;
   if((fm & SYMBOL_FILLING_IOC) != 0) modes[nm++] = ORDER_FILLING_IOC;
   if((fm & SYMBOL_FILLING_FOK) != 0) modes[nm++] = ORDER_FILLING_FOK;
   modes[nm++] = ORDER_FILLING_RETURN;

   for(int i = 0; i < nm; i++)
     {
      MqlTick t;
      if(!SymbolInfoTick(sym, t))
        { comment = "no tick"; return false; }
      MqlTradeRequest rq;
      MqlTradeResult  rs;
      ZeroMemory(rq);
      ZeroMemory(rs);
      rq.action       = TRADE_ACTION_DEAL;
      rq.position     = ticket;
      rq.symbol       = sym;
      rq.volume       = vol;
      rq.type         = (type == POSITION_TYPE_BUY) ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
      rq.price        = (type == POSITION_TYPE_BUY) ? t.bid : t.ask;
      rq.deviation    = (ulong)deviation;
      rq.magic        = (ulong)magic;
      rq.type_filling = modes[i];
      bool sent = OrderSend(rq, rs);
      retcode = rs.retcode;
      comment = rs.comment;
      if(sent && (rs.retcode == TRADE_RETCODE_DONE || rs.retcode == TRADE_RETCODE_DONE_PARTIAL))
         return true;
      if(rs.retcode != TRADE_RETCODE_INVALID_FILL)
         return false;        // only a rejected fill mode is worth retrying with another one
     }
   return false;
  }

#endif // AT24_COPIER_MT5EXEC_MQH
