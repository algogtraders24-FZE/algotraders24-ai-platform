void OnStart()
  {
   string syms[3] = {"XAUUSD", "BTCUSD_T", "EURUSD"};
   for(int s = 0; s < 3; s++)
     {
      MqlTick t[]; int n = CopyTicks(syms[s], t, COPY_TICKS_ALL, 0, 5000);
      if(n <= 0) { PrintFormat("TICKPROBE %s ticks=%d err=%d", syms[s], n, GetLastError()); continue; }
      int fb = 0, fs = 0, fl = 0, fbid = 0, fask = 0, vol = 0, rv = 0;
      for(int i = 0; i < n; i++)
        {
         if((t[i].flags & TICK_FLAG_BUY) != 0) fb++;
         if((t[i].flags & TICK_FLAG_SELL) != 0) fs++;
         if((t[i].flags & TICK_FLAG_LAST) != 0) fl++;
         if((t[i].flags & TICK_FLAG_BID) != 0) fbid++;
         if((t[i].flags & TICK_FLAG_ASK) != 0) fask++;
         if(t[i].volume > 0) vol++;
         if(t[i].volume_real > 0.0) rv++;
        }
      PrintFormat("TICKPROBE %s ticks=%d first=%s last=%s buyflag=%d sellflag=%d lastflag=%d bidflag=%d askflag=%d vol>0=%d realvol>0=%d", syms[s], n, TimeToString(t[0].time, TIME_DATE | TIME_SECONDS), TimeToString(t[n - 1].time, TIME_DATE | TIME_SECONDS), fb, fs, fl, fbid, fask, vol, rv);
      MqlBookInfo bk[]; bool ok = MarketBookAdd(syms[s]); int nb = ok ? (MarketBookGet(syms[s], bk) ? ArraySize(bk) : 0) : -1;
      PrintFormat("TICKPROBE %s marketbook add=%d levels=%d", syms[s], ok ? 1 : 0, nb);
     }
  }
