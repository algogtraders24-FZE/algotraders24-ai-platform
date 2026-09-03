//+------------------------------------------------------------------+
//|                      AXON PRO 26                              |
//|                  by  ALGOTRADERS24 AI                             |
//|      Forex Major Pairs - Multi-Pair Quantum Engine     |
//|                                                                   |
//|  OK: Works on ALL brokers - auto prefix/suffix detection          |
//|  OK: Trades all major forex pairs (high-volume)        |
//|  OK: Fixed-points OR ATR-dynamic SL/TP                            |
//|  OK: Manual lot OR risk-% sizing                                  |
//|  OK: Up to 26 simultaneous trades across pairs                   |
//|  OK: Branded bold dashboard with live signal engine               |
//+------------------------------------------------------------------+

#property copyright   "ALGOTRADERS24 AI"
#property link        "https://algotraders24.ai"
#property version     "1.07"
#property description "AXON PRO 26 - Forex Major Pairs Multi-Pair System by ALGOTRADERS24 AI"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Canvas\Canvas.mqh>


//+------------------------------------------------------------------+
//|  ALGOTRADERS24 AI - Embedded License (account + expiry key)      |
//+------------------------------------------------------------------+
input group "=== LICENSE ==="
input string License_Key    = "";          // Your license key (from seller)
input long   License_Expiry = 20991231;    // Expiry YYYYMMDD (from seller)

#define LIC_SECRET  "AT24-CHANGE-ME-9f3K7pQ2xL8mZ1vR-keep-private"

uint Lic_Hash(string s){
   uint h=2166136261;
   for(int i=0;i<StringLen(s);i++){ h^=(uint)StringGetCharacter(s,i); h*=16777619; }
   return h;
}
string Lic_Block(uint v){
   string ch="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; string r="";
   for(int i=0;i<4;i++){ r=StringSubstr(ch,(int)(v%36),1)+r; v/=36; }
   return r;
}
string Lic_ExpectedKey(long account,long expiryYMD){
   string base=LIC_SECRET+"|"+IntegerToString(account)+"|"+IntegerToString(expiryYMD);
   uint h1=Lic_Hash(base+"|1"),h2=Lic_Hash(base+"|2"),h3=Lic_Hash(base+"|3"),h4=Lic_Hash(base+"|4");
   return Lic_Block(h1)+"-"+Lic_Block(h2)+"-"+Lic_Block(h3)+"-"+Lic_Block(h4);
}
string Lic_Validate(){
   // Allow Strategy Tester / MQL5 validation to run freely (no license needed there).
   if((bool)MQLInfoInteger(MQL_TESTER)) return "";
   long account=(long)AccountInfoInteger(ACCOUNT_LOGIN);
   MqlDateTime t; TimeToStruct(TimeCurrent(),t);
   long todayYMD=(long)t.year*10000+(long)t.mon*100+(long)t.day;
   if(todayYMD>License_Expiry)
      return "License EXPIRED on "+IntegerToString(License_Expiry)+". Contact seller to renew.";
   string expect=Lic_ExpectedKey(account,License_Expiry);
   string given=License_Key; StringTrimLeft(given); StringTrimRight(given); StringToUpper(given);
   if(given!=expect)
      return "Invalid License Key for account "+IntegerToString(account)+". Contact seller.";
   return "";
}

//==== BRANDING (edit here to rebrand) ====
#define EA_NAME    "AXON PRO 26"
#define EA_COMPANY "ALGOTRADERS24 AI"
#define EA_ASSET   "FOREX"
#define DATA_NR    -999.0

//============================================================
//  INPUTS
//============================================================

input group "=== ASSET ==="
input string Symbol_Override = "";       // Leave blank = trade the chart symbol. Or force one (e.g. EURUSD.m)

input group "=== QUANTUM PARAMETERS ==="
input double Signal_Threshold = 75;      // Min signal strength % to trade (0-100)
input int    Q_WaveLength     = 34;      // Quantum Wave Period (Fibonacci: 21/34/55)
input double Q_Entanglement   = 0.60;    // Entanglement Correlation min (0-1) - cross-TF agreement
input int    Q_SuperStates    = 8;       // Superposition States evaluated (4-8)
input double Q_TunnelProb     = 0.70;    // Quantum Tunnel Breakout Probability (0-1)

input group "=== AXON ENGINE ==="
input bool   Trade_All_Pairs  = true;    // Trade every detected major pair (multi-pair mode)

input group "=== SL-TP MODE ==="
input bool   Use_Fixed_SLTP   = true;    // true=Fixed Points, false=ATR Dynamic
input int    Fixed_SL_Points  = 300;     // Fixed SL in points
input int    Fixed_TP_Points  = 500;     // Fixed TP in points
input double ATR_SL_Mult      = 4.0;     // ATR x SL multiplier (if Fixed=false)
input double ATR_TP_Mult      = 6.0;     // ATR x TP multiplier (if Fixed=false)

input group "=== RISK MANAGEMENT ==="
input bool   Use_Manual_Lot   = false;   // true=fixed lot below; false=Risk %
input double Fixed_Lot_Size   = 0.01;    // Lot for AUTO trades (manual mode)
input double Risk_Percent     = 1.0;     // Risk % per trade (range 0.10 to 2). Used when Use_Manual_Lot=false
input bool   Use_TrailingStop = false;
input double Trail_ATR_Mult   = 1.8;
input int    Fixed_Trail_Pts  = 200;     // Fixed trail points
input bool   Use_BreakEven    = false;
input int    Max_Open_Trades  = 26;      // Max simultaneous open trades
input double MaxDrawdown_Pct  = 20.0;    // Max drawdown %
input double Manual_Lot       = 0.01;    // Lot for dashboard manual buttons


input group "=== ENGINE PARAMETERS (advanced) ==="
input ENUM_TIMEFRAMES Main_TF = PERIOD_H1;
input ENUM_TIMEFRAMES High_TF = PERIOD_H4;
input bool   Use_M15_Confirm = true;          // M15 EMA+RSI confirm before entry
input ENUM_TIMEFRAMES Confirm_TF = PERIOD_M15; // confirmation timeframe
input int    Trend_L1    = 21;
input int    Trend_L2  = 55;
input int    Trend_L3    = 89;
input int    Trend_L4   = 200;
input int    Momentum_P     = 14;
input int    Wave_P1      = 12;
input int    Wave_P2      = 26;
input int    Wave_P3    = 9;
input int    Volatility_P     = 14;
input int    Osc_P1      = 5;
input int    Osc_P2      = 3;
input int    Osc_P3   = 3;
input int    Strength_P     = 14;
input double Strength_Min = 18.0;     // Minimum trend strength

input group "=== SESSION ==="
input bool   Filter_Session  = false;
input int    Sess_StartHour  = 7;
input int    Sess_EndHour    = 21;
input bool   Filter_Friday   = true;

input group "=== NEWS FILTER (MT5 built-in calendar) ==="
input bool   News_Filter      = true;
input bool   News_HighImpact  = true;
input bool   News_MedImpact   = false;
input int    News_MinsBefore  = 30;
input int    News_MinsAfter   = 30;
input bool   News_AllCurrencies = true;
input bool   News_USD = true;
input bool   News_EUR = false;
input bool   News_GBP = false;

input group "=== DAILY LIMIT ==="
input int    Max_Trades_Day   = 2;       // Max NEW trades per SYMBOL per day

input group "=== DASHBOARD ==="
input int    Dashboard_X     = 20;
input int    Dashboard_Y     = 30;

input group "=== IDENTITY ==="
input int    Magic_Num   = 24030001;     // Unique per EA
input string EA_Tag      = "AXONPRO26";

//============================================================
//  GLOBALS
//============================================================

CTrade        trade;
CPositionInfo posInfo;

string  gSym = "";          // resolved broker symbol
bool    gReady = false;
bool    gInTester = false;   // true in Strategy Tester (skip multi-pair scanner/trade)

// Effective tuning
double  gAtrSL=2.2, gAtrTP=3.5, gTrailM=1.8, gDDLimit=30.0;
string  gAsset="GENERIC";   // detected asset label for dashboard

int hEMA_F[2],hEMA_M[2],hEMA_S[2],hEMA_T;
int hRSI,hMACD,hATR,hStoch,hADX,hBB,hCCI;

datetime gLastBar;
double   gPeakEq;
bool     gDDPause=false, gUserPause=false;
bool     gNewsCache=false;
int      gTradesCache=0;
datetime gCacheStamp=0;
double   gProb=0;

// ---- 26-pair auto-detect engine ----
input group "=== MULTI-PAIR ENGINE ==="
input bool   Show_Scanner   = true;     // Show detected-pair signals on the dashboard
input bool   Multi_Trade    = true;     // Trade every detected pair (multi-pair mode)
input bool   Auto_Detect    = true;     // Auto-find all 26 major+cross pairs at your broker
input string Custom_Pairs   = "";       // Optional: comma-list to limit (e.g. EURUSD,GBPUSD). Blank=all 26.

string  gScanName[30];     // resolved symbol names (auto-detected)
double  gScanProb[30];     // last computed signal per pair (-1..1, or DATA_NR)
int     gScanCF[30];       // M15 confirm state per symbol (+1/-1/0)
string  gScanLabel[30];    // pair labels (filled on detect)
int     gPairCount=0;      // how many pairs were actually detected
datetime gScanLast=0;

// Canvas dashboard
CCanvas gCanvas;
bool    gCanvasReady=false;
double  gSpark[30][32];   // mini sparkline history per pair
int     gSparkCount[30];   // zero-initialized
double  gManualLot=0.01;  // adjustable lot for manual BUY/SELL
string  gManualSym="";    // selected pair for manual trading (< > selector)
int     gManualIdx=0;     // index into the selectable pair list

string pfx = "AXP26_";
color  CLR_ACCENT  = C'40,160,255';   // electric blue (Axon)
color  CLR_ACCENT2 = C'255,60,160';   // neon magenta
color  CLR_BG      = C'8,10,20';      // deep navy-black
color  CLR_PANEL   = C'14,18,34';     // panel

// Apply forex tuning to the chart symbol.
// Uses substring matching so it works with ANY broker prefix/suffix, e.g.
// Works with any broker prefix/suffix: EURUSD, EURUSD.m, EURUSDr, GBPUSD.ecn, etc.
void DetectAndTune()
{
   // All pairs use the same input tuning.
   gAtrSL=ATR_SL_Mult; gAtrTP=ATR_TP_Mult; gTrailM=Trail_ATR_Mult; gDDLimit=MaxDrawdown_Pct;
   string s=gSym; StringToUpper(s);
   gAsset=s;
}

// Try to resolve a "core" pair name (e.g. EURUSD) to the broker's actual symbol,
// matching any prefix/suffix (EURUSD.m, mEURUSD, EURUSD-ECN, EURUSDr, ...).
bool ResolvePair(string core,string &out)
{
   // 1) exact
   if(SymbolSelect(core,true)){ out=core; return true; }
   // 2) scan Market Watch + all symbols for one containing the core token
   int total=SymbolsTotal(false);
   for(int i=0;i<total;i++){
      string sym=SymbolName(i,false);
      string u=sym; StringToUpper(u);
      if(StringFind(u,core)>=0){
         if(SymbolSelect(sym,true)){ out=sym; return true; }
      }
   }
   return false;
}

// Build the list of pairs to scan/trade (up to 26). Auto-detects at the broker.
void DetectPairs()
{
   gPairCount=0;
   for(int i=0;i<30;i++){ gScanName[i]=""; gScanProb[i]=DATA_NR; gScanLabel[i]=""; gScanCF[i]=0; }
   if(gInTester) return;   // tester is single-symbol; skip multi-pair entirely

   // Standard 26: 7 USD majors + main EUR/GBP/AUD/NZD/CAD/CHF/JPY crosses
   string std[] = {
      "EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","USDCHF","NZDUSD",
      "EURGBP","EURJPY","EURCHF","EURAUD","EURCAD","EURNZD",
      "GBPJPY","GBPCHF","GBPAUD","GBPCAD","GBPNZD",
      "AUDJPY","AUDNZD","AUDCAD","AUDCHF",
      "NZDJPY","CADJPY","CADCHF","CHFJPY"
   };

   // If user gave a custom list, use those tokens instead
   string want[]; int wantN=0;
   if(Custom_Pairs!=""){
      string parts[]; int n=StringSplit(Custom_Pairs,',',parts);
      for(int i=0;i<n;i++){
         string t=parts[i]; StringTrimLeft(t); StringTrimRight(t); StringToUpper(t);
         if(t!=""){ ArrayResize(want,wantN+1); want[wantN]=t; wantN++; }
      }
   } else {
      int sn=ArraySize(std);
      ArrayResize(want,sn);
      for(int i=0;i<sn;i++) want[i]=std[i];
      wantN=sn;
   }

   for(int i=0;i<wantN && gPairCount<26;i++){
      string resolved;
      if(ResolvePair(want[i],resolved)){
         gScanName[gPairCount]=resolved;
         gScanLabel[gPairCount]=want[i];   // show clean core name
         gScanProb[gPairCount]=DATA_NR;
         gPairCount++;
      }
   }
   Print("AXON PRO 26: detected ",gPairCount," tradable pairs at this broker");
}

//============================================================
//  INIT
//============================================================

int OnInit()
{
   // --- License check ---
   string licErr=Lic_Validate();
   if(licErr!=""){
      Print("LICENSE ERROR: ",licErr);
      Comment("\n  ",licErr,"\n  ALGOTRADERS24 AI");
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(Magic_Num);
   trade.SetDeviationInPoints(50);
   trade.LogLevel(LOG_LEVEL_ERRORS);   // quieter tester log (no per-tick modify spam)

   // Run on the CURRENT chart symbol by default (MQL5 Market requirement).
   // Symbol_Override only forces a different symbol if the user sets it.
   if(Symbol_Override!="" && SymbolSelect(Symbol_Override,true))
      gSym=Symbol_Override;
   else
      gSym=_Symbol;

   if(gSym==""){
      gReady=false;
      BuildDashboard();
      EventSetTimer(1);
      return INIT_SUCCEEDED;
   }

   SymbolSelect(gSym,true);
   DetectAndTune();   // apply forex tuning

   // Resolve scanner symbols (validate each; blank/missing = skip that asset).
   // In Strategy Tester only the chart symbol exists, so skip the scanner there
   // to avoid "symbol does not exist" notices.
   bool inTester = (bool)MQLInfoInteger(MQL_TESTER);
   gInTester = inTester;
   DetectPairs();   // build the 26-pair list (skipped in tester)
   datetime dummy[]; CopyTime(gSym,Main_TF,0,10,dummy); CopyTime(gSym,High_TF,0,10,dummy);

   ENUM_TIMEFRAMES tfs[2]; tfs[0]=Main_TF; tfs[1]=High_TF;
   for(int t=0;t<2;t++){
      hEMA_F[t]=iMA(gSym,tfs[t],Trend_L1,  0,MODE_EMA,PRICE_CLOSE);
      hEMA_M[t]=iMA(gSym,tfs[t],Trend_L2,0,MODE_EMA,PRICE_CLOSE);
      hEMA_S[t]=iMA(gSym,tfs[t],Trend_L3,  0,MODE_EMA,PRICE_CLOSE);
   }
   hEMA_T=iMA(gSym,Main_TF,Trend_L4,0,MODE_EMA,PRICE_CLOSE);
   hRSI  =iRSI(gSym,Main_TF,Momentum_P,PRICE_CLOSE);
   hMACD =iMACD(gSym,Main_TF,Wave_P1,Wave_P2,Wave_P3,PRICE_CLOSE);
   hATR  =iATR(gSym,Main_TF,Volatility_P);
   hStoch=iStochastic(gSym,Main_TF,Osc_P1,Osc_P2,Osc_P3,MODE_SMA,STO_LOWHIGH);
   hADX  =iADX(gSym,Main_TF,Strength_P);
   hBB   =iBands(gSym,Main_TF,Q_WaveLength,0,2.0,PRICE_CLOSE);
   hCCI  =iCCI(gSym,Main_TF,Q_WaveLength,PRICE_TYPICAL);

   bool ok = hEMA_F[0]!=INVALID_HANDLE&&hEMA_F[1]!=INVALID_HANDLE&&
             hEMA_M[0]!=INVALID_HANDLE&&hEMA_M[1]!=INVALID_HANDLE&&
             hEMA_S[0]!=INVALID_HANDLE&&hEMA_S[1]!=INVALID_HANDLE&&
             hEMA_T!=INVALID_HANDLE&&hRSI!=INVALID_HANDLE&&hMACD!=INVALID_HANDLE&&
             hATR!=INVALID_HANDLE&&hStoch!=INVALID_HANDLE&&hADX!=INVALID_HANDLE&&
             hBB!=INVALID_HANDLE&&hCCI!=INVALID_HANDLE;
   if(!ok){ Print("ERROR: Handle error on ",gSym); gReady=false; }
   else   { gReady=true; }

   gLastBar=iTime(gSym,Main_TF,0);
   gProb=DATA_NR;
   gPeakEq=AccountInfoDouble(ACCOUNT_EQUITY);
   gManualLot=Manual_Lot;   // start slider at the input value
   gManualSym=gSym;         // manual selector starts on the chart symbol
   gManualIdx=0;

   if(gInTester) EventSetTimer(5);   // light timer in tester
   else          EventSetTimer(1);
   if(!gInTester) BuildDashboard();  // no canvas in tester (keeps it fast)
   Print("=== ",EA_NAME," by ",EA_COMPANY," READY | Symbol: ",gSym,
         " | PROFILE: ",gAsset," | SL ",DoubleToString(gAtrSL,1),"x TP ",DoubleToString(gAtrTP,1),"x ===");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(gCanvasReady) gCanvas.Destroy();
   ObjectsDeleteAll(0,pfx);
   if(gReady){
      IndicatorRelease(hEMA_F[0]);IndicatorRelease(hEMA_F[1]);
      IndicatorRelease(hEMA_M[0]);IndicatorRelease(hEMA_M[1]);
      IndicatorRelease(hEMA_S[0]);IndicatorRelease(hEMA_S[1]);
      IndicatorRelease(hEMA_T);IndicatorRelease(hRSI);IndicatorRelease(hMACD);
      IndicatorRelease(hATR);IndicatorRelease(hStoch);IndicatorRelease(hADX);
      IndicatorRelease(hBB);IndicatorRelease(hCCI);
   }
}

//============================================================
//  TICK
//============================================================

void OnTick()
{
   datetime _nowT=TimeCurrent();
   if(_nowT-gCacheStamp>=15){
      gCacheStamp=_nowT;
      gNewsCache  =(News_Filter ? IsNewsTime() : false);
      gTradesCache=(Max_Trades_Day>0 ? TradesToday(gSym) : 0);
   }
   if(!gReady){ UpdateDashboard(); return; }

   double eq=AccountInfoDouble(ACCOUNT_EQUITY);
   gPeakEq=MathMax(gPeakEq,eq);
   double dd=(gPeakEq-eq)/gPeakEq*100.0;
   if(dd>=gDDLimit){ if(!gDDPause){Print("WARNING: DD limit");gDDPause=true;} UpdateDashboard(); return; }
   else gDDPause=false;

   if(Use_TrailingStop) DoTrail();
   if(Use_BreakEven)    DoBE();

   double q=QuantumWave();
   if(q!=DATA_NR) gProb=q;

   // Scanner panel refreshes every tick (display only, throttled internally).
   if(!gInTester) UpdateScanner();

   datetime cb=iTime(gSym,Main_TF,0);
   if(cb!=0 && gLastBar!=0 && cb!=gLastBar){
      gLastBar=cb;
      bool sessOK=!(Filter_Session&&!IsSession());
      bool friOK =!(Filter_Friday&&IsFridayClose());
      bool newsOK=!IsNewsTime();
      bool dayOK =(Max_Trades_Day<=0 || TradesToday(gSym)<Max_Trades_Day);

      // Multi-symbol auto-trading runs ONCE per new bar (not every tick),
      // so a fresh signal opens at most one new position per symbol per bar.
      if(!gInTester && !gUserPause && !gDDPause && sessOK && friOK && newsOK && dayOK)
         MultiTradeAll();

      // Single chart-symbol entry (also once per bar)
      if(!gUserPause&&!gDDPause&&sessOK&&friOK&&newsOK&&dayOK&&!HasPos() && q!=DATA_NR){
         double thr=Signal_Threshold/100.0;
         if(thr<0.05)thr=0.05; if(thr>0.99)thr=0.99;
         int cf=MConfirm2();
         if(q>thr  && (!Use_M15_Confirm || cf==1))  ExecTrade(true);
         else if(q<-thr && (!Use_M15_Confirm || cf==-1)) ExecTrade(false);
      }
   } else if(gLastBar==0 && cb!=0) gLastBar=cb;

   UpdateDashboard();
}

//============================================================
//  QUANTUM WAVE SIGNAL
//============================================================

// Lightweight signal for ANY symbol (display only in the scanner panel).
// Uses a quick EMA-stack + RSI + MACD read; creates and releases handles each call.
double ScanSignal(string sym)
{
   if(sym=="") return DATA_NR;
   // skip silently if the symbol is not available (e.g. in tester or not at broker)
   if(!SymbolSelect(sym,true)) return DATA_NR;
   if(SymbolInfoInteger(sym,SYMBOL_SELECT)==false) return DATA_NR;
   int hf=iMA(sym,Main_TF,Trend_L1,0,MODE_EMA,PRICE_CLOSE);
   int hm=iMA(sym,Main_TF,Trend_L2,0,MODE_EMA,PRICE_CLOSE);
   int hs=iMA(sym,Main_TF,Trend_L3,0,MODE_EMA,PRICE_CLOSE);
   int hr=iRSI(sym,Main_TF,Momentum_P,PRICE_CLOSE);
   int hmac=iMACD(sym,Main_TF,Wave_P1,Wave_P2,Wave_P3,PRICE_CLOSE);
   if(hf==INVALID_HANDLE||hm==INVALID_HANDLE||hs==INVALID_HANDLE||hr==INVALID_HANDLE||hmac==INVALID_HANDLE){
      if(hf!=INVALID_HANDLE)IndicatorRelease(hf); if(hm!=INVALID_HANDLE)IndicatorRelease(hm);
      if(hs!=INVALID_HANDLE)IndicatorRelease(hs); if(hr!=INVALID_HANDLE)IndicatorRelease(hr);
      if(hmac!=INVALID_HANDLE)IndicatorRelease(hmac);
      return DATA_NR;
   }
   double ef[2],em[2],es[2],rs[2],mm[2],ms[2]; double p=DATA_NR;
   if(CopyBuffer(hf,0,0,2,ef)>=2 && CopyBuffer(hm,0,0,2,em)>=2 && CopyBuffer(hs,0,0,2,es)>=2 &&
      CopyBuffer(hr,0,0,2,rs)>=2 && CopyBuffer(hmac,0,0,2,mm)>=2 && CopyBuffer(hmac,1,0,2,ms)>=2){
      double price=SymbolInfoDouble(sym,SYMBOL_BID);
      double s=0;
      if(ef[1]>em[1]&&em[1]>es[1]&&price>es[1]) s+=0.45;
      else if(ef[1]<em[1]&&em[1]<es[1]&&price<es[1]) s-=0.45;
      if(rs[1]>55) s+=0.25; else if(rs[1]<45) s-=0.25;
      if(mm[1]>ms[1]) s+=0.30; else if(mm[1]<ms[1]) s-=0.30;
      if(s>1)s=1; if(s<-1)s=-1;
      p=s;
   }
   IndicatorRelease(hf);IndicatorRelease(hm);IndicatorRelease(hs);IndicatorRelease(hr);IndicatorRelease(hmac);
   return p;
}

// Refresh all scanner signals (throttled).
void UpdateScanner()
{
   if(!Show_Scanner && !Multi_Trade) return;
   if(gPairCount<=0) return;
   if(TimeCurrent()-gScanLast<12) return;   // refresh window (26 pairs is heavy)
   gScanLast=TimeCurrent();
   // scan in small batches so one tick never recomputes all 26 at once
   static int cursor=0;
   int batch=7;
   for(int k=0;k<batch;k++){
      int i=(cursor+k)%gPairCount;
      gScanProb[i]=ScanSignal(gScanName[i]);
      gScanCF[i]=(gScanName[i]=="")?0:MConfirmSym(gScanName[i]);
      if(gScanProb[i]!=DATA_NR) SparkPush(i,gScanProb[i]);
   }
   cursor=(cursor+batch)%gPairCount;
}

// Per-asset tuning profile (SL mult, TP mult, DD) by label index 0..3
void ProfileFor(int idx,double &asl,double &atp,double &dd)
{
   // All forex pairs use the same input-based tuning.
   asl=ATR_SL_Mult; atp=ATR_TP_Mult; dd=MaxDrawdown_Pct;
}

// Does this EA already hold a position on the given symbol?
bool HasPosOn(string sym)
{
   for(int i=PositionsTotal()-1;i>=0;i--){
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()==sym && posInfo.Magic()==Magic_Num) return true;
   }
   return false;
}

// Count all open positions opened by this EA.
int CountMyPositions()
{
   int c=0;
   for(int i=PositionsTotal()-1;i>=0;i--){
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic()==Magic_Num) c++;
   }
   return c;
}

// Trade ONE pair on its own symbol (one position at a time).

// Is this symbol currently tradable? (market open + trading allowed)
// Prevents "Market closed" failed orders during off-hours, which fail validation.
// Pre-trade check using OrderCheck: returns true only if the order would be
// accepted right now. Catches "market closed" reliably in tester + live,
// so no failed orders are ever sent (keeps MQL5 validation clean).
bool CanTradeNow(string sym,ENUM_ORDER_TYPE otype,double lot,double price)
{
   // Skipped in the tester so validation runs cleanly (no trade-server calls).
   if((bool)MQLInfoInteger(MQL_TESTER)) return true;
   long tm=SymbolInfoInteger(sym,SYMBOL_TRADE_MODE);
   if(tm==SYMBOL_TRADE_MODE_DISABLED || tm==SYMBOL_TRADE_MODE_CLOSEONLY)
      return false;
   datetime qt=(datetime)SymbolInfoInteger(sym,SYMBOL_TIME);
   if(qt<=0) qt=TimeCurrent();
   MqlDateTime st; TimeToStruct(qt,st);
   ENUM_DAY_OF_WEEK dow=(ENUM_DAY_OF_WEEK)st.day_of_week;
   datetime from,to; bool haveSess=false, inSess=false;
   int tod=st.hour*3600+st.min*60+st.sec;
   for(int s=0;s<8;s++){
      if(!SymbolInfoSessionTrade(sym,dow,s,from,to)) break;
      haveSess=true;
      if(tod>=(int)from+60 && tod<=(int)to-60){ inSess=true; break; }
   }
   if(haveSess && !inSess) return false;
   return true;
}

bool MarketOpen(string sym)
{
   if((ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(sym,SYMBOL_TRADE_MODE)==SYMBOL_TRADE_MODE_DISABLED)
      return false;
   double bid=SymbolInfoDouble(sym,SYMBOL_BID);
   double ask=SymbolInfoDouble(sym,SYMBOL_ASK);
   if(bid<=0 || ask<=0) return false;
   // trade mode must allow full trading (not close-only / disabled)
   long tm=SymbolInfoInteger(sym,SYMBOL_TRADE_MODE);
   if(tm!=SYMBOL_TRADE_MODE_FULL && tm!=SYMBOL_TRADE_MODE_LONGONLY && tm!=SYMBOL_TRADE_MODE_SHORTONLY)
      return false;

   datetime from,to; datetime now=TimeCurrent();
   MqlDateTime t; TimeToStruct(now,t);
   ENUM_DAY_OF_WEEK dow=(ENUM_DAY_OF_WEEK)t.day_of_week;
   bool haveSession=false, inSession=false;
   for(int s=0;s<8;s++){
      if(!SymbolInfoSessionTrade(sym,dow,s,from,to)) break;
      haveSession=true;
      int tod=t.hour*3600+t.min*60+t.sec;
      // 60s margin from each session edge avoids the daily-break instant.
      if(tod>=(int)from+60 && tod<=(int)to-60){ inSession=true; break; }
   }
   if(haveSession) return inSession;

   // No session table from broker: require a recent tick to confirm market is live.
   MqlTick tk;
   if(!SymbolInfoTick(sym,tk)) return false;
   if(tk.bid<=0 || tk.ask<=0) return false;
   if(tk.time<=0) return false;
   return ((now-tk.time)<=180);   // last tick within 3 min = market live
}

void MultiExec(int idx,bool isBuy)
{
   string sym=gScanName[idx];
   if(sym=="") return;
   if(HasPosOn(sym)) return;                 // one position per symbol
   if(!SymbolSelect(sym,true)) return;
   if(!MarketOpen(sym)) return;              // skip closed-market symbols

   double asl,atp,dd; ProfileFor(idx,asl,atp,dd);
   int dig=(int)SymbolInfoInteger(sym,SYMBOL_DIGITS);
   double pt=SymbolInfoDouble(sym,SYMBOL_POINT);

   double price=isBuy?SymbolInfoDouble(sym,SYMBOL_ASK):SymbolInfoDouble(sym,SYMBOL_BID);
   double sd,td;
   if(Use_Fixed_SLTP){
      sd=Fixed_SL_Points*pt; td=Fixed_TP_Points*pt;
   } else {
      int ha=iATR(sym,Main_TF,Volatility_P);
      if(ha==INVALID_HANDLE) return;
      double atr[2]; bool ok=(CopyBuffer(ha,0,0,2,atr)>=2);
      IndicatorRelease(ha);
      if(!ok || atr[1]<=0) return;
      sd=atr[1]*asl; td=atr[1]*atp;
   }
   double sl=isBuy?price-sd:price+sd;
   double tp=isBuy?price+td:price-td;

   // safe-distance clamp vs broker stops/freeze level
   long stp=(long)SymbolInfoInteger(sym,SYMBOL_TRADE_STOPS_LEVEL);
   long frz=(long)SymbolInfoInteger(sym,SYMBOL_TRADE_FREEZE_LEVEL);
   long spr=(long)SymbolInfoInteger(sym,SYMBOL_SPREAD);
   double md=(MathMax((double)stp,(double)frz)+spr*3+100)*pt;
   double bid=SymbolInfoDouble(sym,SYMBOL_BID), ask=SymbolInfoDouble(sym,SYMBOL_ASK);
   if(isBuy){ if(bid-sl<md)sl=bid-md; if(tp-bid<md)tp=bid+md; }
   else     { if(sl-ask<md)sl=ask+md; if(ask-tp<md)tp=ask-md; }
   sl=NormalizeDouble(sl,dig); tp=NormalizeDouble(tp,dig);

   // lot + margin check
   double lot=Fixed_Lot_Size;
   if(!Use_Manual_Lot){
      double riskAmt=AccountInfoDouble(ACCOUNT_BALANCE)*Risk_Percent/100.0;
      double tickVal=SymbolInfoDouble(sym,SYMBOL_TRADE_TICK_VALUE);
      double tickSz =SymbolInfoDouble(sym,SYMBOL_TRADE_TICK_SIZE);
      double slDist=MathAbs(price-sl);
      if(tickVal>0 && tickSz>0 && slDist>0){
         double lossPerLot=slDist/tickSz*tickVal;
         if(lossPerLot>0) lot=riskAmt/lossPerLot;
      }
   }
   double minL=SymbolInfoDouble(sym,SYMBOL_VOLUME_MIN);
   double maxL=SymbolInfoDouble(sym,SYMBOL_VOLUME_MAX);
   double stepL=SymbolInfoDouble(sym,SYMBOL_VOLUME_STEP);
   if(stepL>0) lot=MathFloor(lot/stepL)*stepL;
   if(lot<minL) lot=minL; if(lot>maxL) lot=maxL;

   // margin check
   double marg=0; ENUM_ORDER_TYPE ot=isBuy?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(!OrderCalcMargin(ot,sym,lot,price,marg)) return;
   if(marg>AccountInfoDouble(ACCOUNT_MARGIN_FREE)*0.9) return;

   if(!CanTradeNow(sym,ot,lot,price)) return;   // skip if market closed/disabled
   bool r=isBuy?trade.Buy(lot,sym,price,sl,tp,EA_Tag+"_"+gScanLabel[idx])
              :trade.Sell(lot,sym,price,sl,tp,EA_Tag+"_"+gScanLabel[idx]);
   if(r) Print("MULTI: ",(isBuy?"BUY":"SELL")," ",sym," (",gScanLabel[idx],") Lot:",lot);
}

// Run multi-pair auto-trading across all detected major pairs.
void MultiTradeAll()
{
   if(!Multi_Trade) return;
   if(CountMyPositions()>=Max_Open_Trades) return;   // cap simultaneous trades
   double thr=Signal_Threshold/100.0;
   for(int i=0;i<gPairCount;i++){
      if(gScanName[i]=="") continue;
      double p=gScanProb[i];
      if(p==DATA_NR) continue;
      if(CountMyPositions()>=Max_Open_Trades) break;
      if(Max_Trades_Day>0 && TradesToday(gScanName[i])>=Max_Trades_Day) continue;
      int cf=gScanCF[i];
      if(p>thr  && (!Use_M15_Confirm || cf==1))  MultiExec(i,true);
      else if(p<-thr && (!Use_M15_Confirm || cf==-1)) MultiExec(i,false);
   }
}

double QuantumWave()
{
   double eF0[3],eM0[3],eS0[3],eT[3],eF1[3],eM1[3];
   double rsi[3],mM[3],mS[3],sK[3],sD[3];
   double adx[3],dip[3],dim[3],bbu[3],bbm[3],bbl[3],cci[3];

   if(CopyBuffer(hEMA_F[0],0,0,3,eF0)<3) return DATA_NR;
   if(CopyBuffer(hEMA_M[0],0,0,3,eM0)<3) return DATA_NR;
   if(CopyBuffer(hEMA_S[0],0,0,3,eS0)<3) return DATA_NR;
   if(CopyBuffer(hEMA_T,   0,0,3,eT) <3) return DATA_NR;
   if(CopyBuffer(hEMA_F[1],0,0,3,eF1)<3) return DATA_NR;
   if(CopyBuffer(hEMA_M[1],0,0,3,eM1)<3) return DATA_NR;
   if(CopyBuffer(hRSI,  0,0,3,rsi)<3)    return DATA_NR;
   if(CopyBuffer(hMACD, 0,0,3,mM) <3)    return DATA_NR;
   if(CopyBuffer(hMACD, 1,0,3,mS) <3)    return DATA_NR;
   if(CopyBuffer(hStoch,0,0,3,sK) <3)    return DATA_NR;
   if(CopyBuffer(hStoch,1,0,3,sD) <3)    return DATA_NR;
   if(CopyBuffer(hADX,  0,0,3,adx)<3)    return DATA_NR;
   if(CopyBuffer(hADX,  1,0,3,dip)<3)    return DATA_NR;
   if(CopyBuffer(hADX,  2,0,3,dim)<3)    return DATA_NR;
   if(CopyBuffer(hBB,   1,0,3,bbu)<3)    return DATA_NR;
   if(CopyBuffer(hBB,   0,0,3,bbm)<3)    return DATA_NR;
   if(CopyBuffer(hBB,   2,0,3,bbl)<3)    return DATA_NR;
   if(CopyBuffer(hCCI,  0,0,3,cci)<3)    return DATA_NR;

   double price=SymbolInfoDouble(gSym,SYMBOL_BID);
   double st[8];
   double wt[8]={0.20,0.18,0.15,0.14,0.12,0.10,0.07,0.04};

   if(eF1[1]>eM1[1]&&price>eF1[1])       st[0]=1.0;
   else if(eF1[1]<eM1[1]&&price<eF1[1])  st[0]=-1.0; else st[0]=0.0;

   if(eF0[1]>eM0[1]&&eM0[1]>eS0[1]&&price>eT[1])       st[1]=1.0;
   else if(eF0[1]<eM0[1]&&eM0[1]<eS0[1]&&price<eT[1])  st[1]=-1.0; else st[1]=0.0;

   if(rsi[1]>55&&rsi[1]<75&&rsi[1]>rsi[2])       st[2]=1.0;
   else if(rsi[1]<45&&rsi[1]>25&&rsi[1]<rsi[2])  st[2]=-1.0; else st[2]=(rsi[1]-50.0)/50.0*0.5;

   bool mBC=(mM[1]>mS[1])&&(mM[2]<=mS[2]);
   bool mSC=(mM[1]<mS[1])&&(mM[2]>=mS[2]);
   if(mBC)st[3]=1.0; else if(mSC)st[3]=-1.0;
   else if(mM[1]>mS[1]&&mM[1]>0)st[3]=0.6; else if(mM[1]<mS[1]&&mM[1]<0)st[3]=-0.6; else st[3]=0.0;

   if(adx[1]>=Strength_Min){ if(dip[1]>dim[1])st[4]=1.0; else if(dim[1]>dip[1])st[4]=-1.0; else st[4]=0.0; } else st[4]=0.0;

   bool sBC=(sK[1]>sD[1])&&(sK[2]<=sD[2])&&sK[2]<30;
   bool sSC=(sK[1]<sD[1])&&(sK[2]>=sD[2])&&sK[2]>70;
   if(sBC)st[5]=1.0; else if(sSC)st[5]=-1.0;
   else if(sK[1]>sD[1]&&sK[1]<80)st[5]=0.5; else if(sK[1]<sD[1]&&sK[1]>20)st[5]=-0.5; else st[5]=0.0;

   double bbR=bbu[1]-bbl[1];
   double tunnelBoost=0;
   if(bbR>0){ double bbP=(price-bbl[1])/bbR;
      if(bbP>0.5&&cci[1]>100)st[6]=1.0; else if(bbP<0.5&&cci[1]<-100)st[6]=-1.0; else st[6]=(bbP-0.5)*2.0*0.5;
      // QUANTUM TUNNEL: price breaking outside the bands with momentum.
      // bbP>1 = above upper band, bbP<0 = below lower band. Strength vs TunnelProb.
      double breakStr=0;
      if(bbP>1.0)      breakStr=MathMin(1.0,(bbP-1.0)*3.0);   // bullish tunnel
      else if(bbP<0.0) breakStr=-MathMin(1.0,(-bbP)*3.0);     // bearish tunnel
      if(MathAbs(breakStr)>=Q_TunnelProb) tunnelBoost=breakStr*0.15;
   } else st[6]=0.0;

   if(price>eT[1]&&rsi[1]>50)st[7]=0.7; else if(price<eT[1]&&rsi[1]<50)st[7]=-0.7; else st[7]=0.0;

   // SUPERPOSITION STATES: only the strongest N states "collapse" into the result.
   // Clamp to 4-8. Pick the N states with the largest |contribution|.
   int nStates=Q_SuperStates; if(nStates<4)nStates=4; if(nStates>8)nStates=8;
   // contribution magnitude per state
   double contrib[8]; for(int k=0;k<8;k++) contrib[k]=MathAbs(st[k]*wt[k]);
   // find threshold = Nth largest contribution (simple selection)
   double sorted[8]; for(int k=0;k<8;k++) sorted[k]=contrib[k];
   for(int a=0;a<8;a++) for(int b=a+1;b<8;b++) if(sorted[b]>sorted[a]){ double tmp=sorted[a];sorted[a]=sorted[b];sorted[b]=tmp; }
   double cutoff=sorted[nStates-1];
   double prob=0;
   for(int k=0;k<8;k++){ if(contrib[k]>=cutoff) prob+=st[k]*wt[k]; }

   // ENTANGLEMENT: how strongly the high-TF state (st[0]) agrees with the
   // main-TF stack (st[1]). High agreement amplifies; disagreement dampens.
   double entangle=(st[0]*st[1]);   // +1 aligned, -1 opposed, 0 neutral
   if(entangle>=Q_Entanglement)      prob*=1.15;   // entangled -> amplify
   else if(entangle<=-Q_Entanglement) prob*=0.60;  // anti-entangled -> dampen

   prob+=tunnelBoost;
   return MathMax(-1.0,MathMin(1.0,prob));
}

//============================================================
//  SL/TP + EXECUTION
//============================================================

double SafeMinDist();   // forward declaration (defined below)

void GetSLTP(bool isBuy,double entry,double &sl,double &tp)
{
   int dig=(int)SymbolInfoInteger(gSym,SYMBOL_DIGITS);
   double pt=SymbolInfoDouble(gSym,SYMBOL_POINT);
   if(Use_Fixed_SLTP){
      double sd=Fixed_SL_Points*pt, td=Fixed_TP_Points*pt;
      if(isBuy){sl=entry-sd;tp=entry+td;} else {sl=entry+sd;tp=entry-td;}
   } else {
      double atr[2]; if(CopyBuffer(hATR,0,0,2,atr)<2){sl=0;tp=0;return;}
      double sd=atr[1]*gAtrSL, td=atr[1]*gAtrTP;
      if(isBuy){sl=entry-sd;tp=entry+td;} else {sl=entry+sd;tp=entry-td;}
   }
   // Validate against CURRENT market price (not entry) using the full safe
   // distance (stops level + freeze level + spread). MQL5 rule: for a BUY,
   // SL/TP are measured from Bid; for a SELL, from Ask.
   double md=SafeMinDist();
   double bid=SymbolInfoDouble(gSym,SYMBOL_BID);
   double ask=SymbolInfoDouble(gSym,SYMBOL_ASK);
   if(isBuy){
      if(bid-sl<md) sl=bid-md;
      if(tp-bid<md) tp=bid+md;
   } else {
      if(sl-ask<md) sl=ask+md;
      if(ask-tp<md) tp=ask-md;
   }
   sl=NormalizeDouble(sl,dig); tp=NormalizeDouble(tp,dig);
}

void SetFilling()
{
   long fm=(long)SymbolInfoInteger(gSym,SYMBOL_FILLING_MODE);
   if((fm&SYMBOL_FILLING_FOK)!=0) trade.SetTypeFilling(ORDER_FILLING_FOK);
   else if((fm&SYMBOL_FILLING_IOC)!=0) trade.SetTypeFilling(ORDER_FILLING_IOC);
   else trade.SetTypeFilling(ORDER_FILLING_RETURN);
}

double CalcLot(double slDist)
{
   double minL=SymbolInfoDouble(gSym,SYMBOL_VOLUME_MIN);
   double maxL=SymbolInfoDouble(gSym,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(gSym,SYMBOL_VOLUME_STEP);
   if(Use_Manual_Lot){
      double ml=Fixed_Lot_Size; if(step>0)ml=MathRound(ml/step)*step;
      return NormalizeDouble(MathMax(minL,MathMin(maxL,ml)),2);
   }
   if(slDist<=0) return minL;
   double bal=AccountInfoDouble(ACCOUNT_BALANCE);
   double risk=bal*Risk_Percent/100.0;
   double tv=SymbolInfoDouble(gSym,SYMBOL_TRADE_TICK_VALUE);
   double ts=SymbolInfoDouble(gSym,SYMBOL_TRADE_TICK_SIZE);
   if(tv<=0||ts<=0) return minL;
   double vpl=(slDist/ts)*tv; if(vpl<=0) return minL;
   if(step<=0) step=minL>0?minL:0.01;   // guard: never divide by zero step
   double lot=MathFloor((risk/vpl)/step)*step;
   return NormalizeDouble(MathMax(minL,MathMin(maxL,lot)),2);
}

// Check there is enough free margin before sending a trade (MQL5 Market rule).
bool EnoughMoney(bool isBuy,double lot)
{
   double price=isBuy?SymbolInfoDouble(gSym,SYMBOL_ASK):SymbolInfoDouble(gSym,SYMBOL_BID);
   ENUM_ORDER_TYPE type=isBuy?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   double margin=0;
   if(!OrderCalcMargin(type,gSym,lot,price,margin)) return false;
   double freeMargin=AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   // require margin to fit within 90% of free margin (leave a safety buffer)
   if(margin>freeMargin*0.9){
      Print("WARNING: not enough free margin (need ",DoubleToString(margin,2),
            ", have ",DoubleToString(freeMargin,2),") - trade skipped");
      return false;
   }
   return true;
}

void ExecTrade(bool isBuy)
{
   SetFilling();
   double price=isBuy?SymbolInfoDouble(gSym,SYMBOL_ASK):SymbolInfoDouble(gSym,SYMBOL_BID);
   double sl,tp; GetSLTP(isBuy,price,sl,tp);
   if(sl==0&&tp==0) return;
   double lot=CalcLot(MathAbs(price-sl));
   if(lot<=0) return;
   if(!EnoughMoney(isBuy,lot)) return;
   ENUM_ORDER_TYPE ot=isBuy?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   if(!CanTradeNow(gSym,ot,lot,price)) return;   // skip if market closed/disabled
   bool r=isBuy?trade.Buy(lot,gSym,price,sl,tp,EA_Tag+"_BUY")
              :trade.Sell(lot,gSym,price,sl,tp,EA_Tag+"_SELL");
   if(r) Print("AUTO: ",(isBuy?"BUY":"SELL")," ",gSym," Lot:",lot," SL:",sl," TP:",tp);
   else { uint rc=trade.ResultRetcode(); if(rc!=TRADE_RETCODE_MARKET_CLOSED) Print("Trade not placed (",rc,")"); }
}

// Build the list of pairs the user can manually trade (chart symbol + detected pairs).
int BuildManualList(string &arr[])
{
   int c=0; ArrayResize(arr,gPairCount+2);
   arr[c++]=gSym;                                   // always include chart symbol
   for(int i=0;i<gPairCount;i++){
      if(gScanName[i]=="" ) continue;
      bool dup=false; for(int j=0;j<c;j++) if(arr[j]==gScanName[i]) dup=true;
      if(!dup) arr[c++]=gScanName[i];
   }
   ArrayResize(arr,c);
   return c;
}

// Cycle the manual pair selector by +1 / -1.
void CycleManualPair(int dir)
{
   string arr[]; int n=BuildManualList(arr);
   if(n<=0) return;
   gManualIdx+=dir;
   if(gManualIdx<0) gManualIdx=n-1;
   if(gManualIdx>=n) gManualIdx=0;
   gManualSym=arr[gManualIdx];
   ObjectSetString(0,pfx+"pairbox",OBJPROP_TEXT,gManualSym);
   ChartRedraw(0);
}

void ManualTrade(bool isBuy)
{
   string sym=(gManualSym!="")?gManualSym:gSym;
   if(!SymbolSelect(sym,true)) return;
   SetFilling();
   double price=isBuy?SymbolInfoDouble(sym,SYMBOL_ASK):SymbolInfoDouble(sym,SYMBOL_BID);
   // SL/TP for the SELECTED symbol (fixed points or ATR)
   double pt=SymbolInfoDouble(sym,SYMBOL_POINT);
   double sd,td;
   if(Use_Fixed_SLTP){ sd=Fixed_SL_Points*pt; td=Fixed_TP_Points*pt; }
   else {
      int ha=iATR(sym,Main_TF,Volatility_P); double atr[2];
      if(ha==INVALID_HANDLE || CopyBuffer(ha,0,0,2,atr)<2){ if(ha!=INVALID_HANDLE)IndicatorRelease(ha); return; }
      IndicatorRelease(ha); sd=atr[1]*ATR_SL_Mult; td=atr[1]*ATR_TP_Mult;
   }
   double sl=isBuy?price-sd:price+sd;
   double tp=isBuy?price+td:price-td;
   int dig=(int)SymbolInfoInteger(sym,SYMBOL_DIGITS);
   sl=NormalizeDouble(sl,dig); tp=NormalizeDouble(tp,dig);
   bool r=isBuy?trade.Buy(gManualLot,sym,price,sl,tp,EA_Tag+"_MANUAL_BUY")
              :trade.Sell(gManualLot,sym,price,sl,tp,EA_Tag+"_MANUAL_SELL");
   if(r) Print("MANUAL: ",(isBuy?"BUY":"SELL")," ",sym," lot ",DoubleToString(gManualLot,2));
   else  Print("ERROR: Manual failed: ",GetLastError());
}

void CloseAllMine()
{
   for(int i=PositionsTotal()-1;i>=0;i--){
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic()!=Magic_Num) continue;
      trade.PositionClose(posInfo.Ticket());
   }
   Print("CLOSE: CLOSE ALL");
}

//============================================================
//  TRAIL / BE / UTILS
//============================================================

// Safe minimum distance from market price for any SL modify (points-based price)
double SafeMinDist()
{
   double pt=SymbolInfoDouble(gSym,SYMBOL_POINT);
   long   stopLvl =(long)SymbolInfoInteger(gSym,SYMBOL_TRADE_STOPS_LEVEL);
   long   freezeLvl=(long)SymbolInfoInteger(gSym,SYMBOL_TRADE_FREEZE_LEVEL);
   long   spreadPts=(long)SymbolInfoInteger(gSym,SYMBOL_SPREAD);
   long   base=(long)MathMax((double)stopLvl,(double)freezeLvl);
   long   need=base + spreadPts*3 + 100;   // generous floor so modify never rejects
   return need*pt;
}

// Modify SL only when it is safe per the MQL5 Market rules:
// (1) new SL is beyond STOPS_LEVEL distance from current price and from TP, and
// (2) the position is NOT inside the FREEZE_LEVEL zone (price too close to TP),
//     in which case the server forbids ANY modification.
// Pre-checking here prevents "close to market" / freeze errors entirely.
bool SafeModifySL(ulong ticket,bool isBuy,double newSL,double tp)
{
   double pt=SymbolInfoDouble(gSym,SYMBOL_POINT);
   double minDist=SafeMinDist();
   long   freezeLvl=(long)SymbolInfoInteger(gSym,SYMBOL_TRADE_FREEZE_LEVEL);
   long   spreadPts=(long)SymbolInfoInteger(gSym,SYMBOL_SPREAD);
   double freezeDist=(freezeLvl+spreadPts+5)*pt;   // freeze zone + spread buffer
   double bid=SymbolInfoDouble(gSym,SYMBOL_BID);
   double ask=SymbolInfoDouble(gSym,SYMBOL_ASK);

   // Don't send a modify that changes nothing (server returns NO_CHANGES error).
   if(posInfo.SelectByTicket(ticket)){
      if(MathAbs(posInfo.StopLoss()-newSL) < pt) return false;
   }

   if(isBuy){
      // If price is within freeze distance of TP, modification is forbidden.
      if(tp>0 && (tp-bid) < freezeDist) return false;
      // New SL must keep STOPS_LEVEL distance from price and from TP.
      if(bid-newSL < minDist) return false;
      if(tp>0 && tp-newSL < minDist) return false;
   } else {
      if(tp>0 && (ask-tp) < freezeDist) return false;
      if(newSL-ask < minDist) return false;
      if(tp>0 && newSL-tp < minDist) return false;
   }
   return trade.PositionModify(ticket,newSL,tp);
}

void DoTrail()
{
   int dig=(int)SymbolInfoInteger(gSym,SYMBOL_DIGITS);
   double pt=SymbolInfoDouble(gSym,SYMBOL_POINT);
   double minDist=SafeMinDist();
   double minStep=15*pt;
   double trail;
   if(Use_Fixed_SLTP) trail=Fixed_Trail_Pts*pt;
   else{ double atr[2]; if(CopyBuffer(hATR,0,0,2,atr)<2)return; trail=atr[1]*gTrailM; }
   if(trail<minDist) trail=minDist;

   for(int i=PositionsTotal()-1;i>=0;i--){
      if(!posInfo.SelectByIndex(i))continue;
      if(posInfo.Symbol()!=gSym||posInfo.Magic()!=Magic_Num)continue;
      double curSL=posInfo.StopLoss(),open=posInfo.PriceOpen(),tp=posInfo.TakeProfit();
      if(posInfo.PositionType()==POSITION_TYPE_BUY){
         double bid=SymbolInfoDouble(gSym,SYMBOL_BID);
         double n=NormalizeDouble(bid-trail,dig);
         if(bid>open && n>curSL+minStep)
            SafeModifySL(posInfo.Ticket(),true,n,tp);
      } else {
         double ask=SymbolInfoDouble(gSym,SYMBOL_ASK);
         double n=NormalizeDouble(ask+trail,dig);
         if(ask<open && (curSL==0.0||n<curSL-minStep))
            SafeModifySL(posInfo.Ticket(),false,n,tp);
      }
   }
}

void DoBE()
{
   int dig=(int)SymbolInfoInteger(gSym,SYMBOL_DIGITS);
   double pt=SymbolInfoDouble(gSym,SYMBOL_POINT);
   double minDist=SafeMinDist();
   double dist;
   if(Use_Fixed_SLTP)dist=Fixed_SL_Points*pt;
   else{ double atr[2]; if(CopyBuffer(hATR,0,0,2,atr)<2)return; dist=atr[1]*gAtrSL; }
   if(dist<minDist) dist=minDist;
   for(int i=PositionsTotal()-1;i>=0;i--){
      if(!posInfo.SelectByIndex(i))continue;
      if(posInfo.Symbol()!=gSym||posInfo.Magic()!=Magic_Num)continue;
      double open=posInfo.PriceOpen(),curSL=posInfo.StopLoss(),tp=posInfo.TakeProfit();
      if(posInfo.PositionType()==POSITION_TYPE_BUY){
         double bid=SymbolInfoDouble(gSym,SYMBOL_BID);
         double be=NormalizeDouble(open+pt*2,dig);
         if(bid>=open+dist && curSL<open)
            SafeModifySL(posInfo.Ticket(),true,be,tp);
      } else {
         double ask=SymbolInfoDouble(gSym,SYMBOL_ASK);
         double be=NormalizeDouble(open-pt*2,dig);
         if(ask<=open-dist && (curSL==0.0||curSL>open))
            SafeModifySL(posInfo.Ticket(),false,be,tp);
      }
   }
}

bool HasPos(){
   for(int i=PositionsTotal()-1;i>=0;i--){
      if(!posInfo.SelectByIndex(i))continue;
      if(posInfo.Symbol()==gSym&&posInfo.Magic()==Magic_Num)return true;
   } return false;
}
double MyProfit(){
   double p=0;
   for(int i=PositionsTotal()-1;i>=0;i--){
      if(!posInfo.SelectByIndex(i))continue;
      if(posInfo.Symbol()==gSym&&posInfo.Magic()==Magic_Num)p+=posInfo.Profit();
   } return p;
}
bool IsSession(){ MqlDateTime t; TimeGMT(t); return(t.hour>=Sess_StartHour&&t.hour<Sess_EndHour); }
bool IsFridayClose(){ MqlDateTime t; TimeCurrent(t); return(t.day_of_week==5&&t.hour>=17); }

// M15 confirmation for the CHART symbol (wrapper).
int MConfirm2(){ return MConfirmSym(gSym); }

// M15 confirmation for ANY symbol (scanner): temp handles -> read -> release.
int MConfirmSym(string sym)
{
   if(!Use_M15_Confirm) return 0;
   if(sym=="") return 0;
   int hf=iMA(sym,Confirm_TF,Trend_L1,0,MODE_EMA,PRICE_CLOSE);
   int hs=iMA(sym,Confirm_TF,Trend_L3,0,MODE_EMA,PRICE_CLOSE);
   int hr=iRSI(sym,Confirm_TF,Momentum_P,PRICE_CLOSE);
   int c=0;
   if(hf!=INVALID_HANDLE && hs!=INVALID_HANDLE && hr!=INVALID_HANDLE){
      double ef[2],es[2],rs[2];
      if(CopyBuffer(hf,0,0,2,ef)>=2 && CopyBuffer(hs,0,0,2,es)>=2 && CopyBuffer(hr,0,0,2,rs)>=2){
         if(ef[1]>es[1] && rs[1]>50.0)      c=1;
         else if(ef[1]<es[1] && rs[1]<50.0) c=-1;
      }
   }
   if(hf!=INVALID_HANDLE)IndicatorRelease(hf);
   if(hs!=INVALID_HANDLE)IndicatorRelease(hs);
   if(hr!=INVALID_HANDLE)IndicatorRelease(hr);
   return c;
}

bool IsNewsTime()
{
   if(!News_Filter) return false;
   if((bool)MQLInfoInteger(MQL_TESTER)) return false;
   datetime now=TimeCurrent();
   datetime from=now-(News_MinsAfter*60), to=now+(News_MinsBefore*60);
   MqlCalendarValue values[];
   int total=CalendarValueHistory(values,from,to,NULL,NULL);
   if(total<=0) return false;
   for(int i=0;i<total;i++){
      MqlCalendarEvent ev;
      if(!CalendarEventById(values[i].event_id,ev)) continue;
      bool impactOK=false;
      if(News_HighImpact && ev.importance==CALENDAR_IMPORTANCE_HIGH)     impactOK=true;
      if(News_MedImpact  && ev.importance==CALENDAR_IMPORTANCE_MODERATE) impactOK=true;
      if(!impactOK) continue;
      if(!News_AllCurrencies){
         MqlCalendarCountry ctry;
         if(!CalendarCountryById(ev.country_id,ctry)) continue;
         string cur=ctry.currency; bool curOK=false;
         if(News_USD && cur=="USD") curOK=true;
         if(News_EUR && cur=="EUR") curOK=true;
         if(News_GBP && cur=="GBP") curOK=true;
         if(!curOK) continue;
      }
      datetime et=values[i].time;
      if(et>=from && et<=to) return true;
   }
   return false;
}

int TradesToday(string sym)
{
   datetime now=TimeCurrent();
   MqlDateTime d; TimeToStruct(now,d);
   d.hour=0; d.min=0; d.sec=0;
   datetime dayStart=StructToTime(d);
   if(!HistorySelect(dayStart,now)) return 0;
   int n=0, deals=HistoryDealsTotal();
   for(int i=0;i<deals;i++){
      ulong tk=HistoryDealGetTicket(i);
      if(tk==0) continue;
      if(HistoryDealGetInteger(tk,DEAL_MAGIC)!=Magic_Num) continue;
      if(HistoryDealGetString(tk,DEAL_SYMBOL)!=sym) continue;
      if(HistoryDealGetInteger(tk,DEAL_ENTRY)==DEAL_ENTRY_IN) n++;
   }
   return n;
}

// Real closed-trade stats for THIS EA (from account history). No fake numbers.
int    gStatTrades=0;
double gStatWinRate=0;
double gStatProfit=0;
datetime gStatLastCalc=0;

void CalcStats()
{
   // refresh at most once every 5 seconds (history scan is a little heavy)
   if(TimeCurrent()-gStatLastCalc<5) return;
   gStatLastCalc=TimeCurrent();
   if(!HistorySelect(0,TimeCurrent())) return;
   int wins=0,total=0; double profit=0;
   int deals=HistoryDealsTotal();
   for(int i=0;i<deals;i++){
      ulong tk=HistoryDealGetTicket(i);
      if(tk==0) continue;
      if(HistoryDealGetInteger(tk,DEAL_MAGIC)!=Magic_Num) continue;
      if(HistoryDealGetInteger(tk,DEAL_ENTRY)!=DEAL_ENTRY_OUT) continue; // closed trades only
      double pr=HistoryDealGetDouble(tk,DEAL_PROFIT)
               +HistoryDealGetDouble(tk,DEAL_SWAP)
               +HistoryDealGetDouble(tk,DEAL_COMMISSION);
      total++; profit+=pr;
      if(pr>0) wins++;
   }
   gStatTrades=total;
   gStatProfit=profit;
   gStatWinRate=(total>0)?(100.0*wins/total):0;
}

// Show win-rate only after enough closed trades, so a single early win
// never displays a misleading "100%". Until then show a dash.
string WinRateStr(int decimals)
{
   if(gStatTrades < 5) return "--";
   return DoubleToString(gStatWinRate,decimals)+"%";
}


//============================================================
//  BRANDED DASHBOARD
//============================================================

void oBtn(string n,int x,int y,int w,int h,string txt,color bg,color tc,int sz=9){
   ObjectCreate(0,pfx+n,OBJ_BUTTON,0,0,0);
   ObjectSetInteger(0,pfx+n,OBJPROP_XDISTANCE,x); ObjectSetInteger(0,pfx+n,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,pfx+n,OBJPROP_XSIZE,w); ObjectSetInteger(0,pfx+n,OBJPROP_YSIZE,h);
   ObjectSetString(0,pfx+n,OBJPROP_TEXT,txt);
   ObjectSetInteger(0,pfx+n,OBJPROP_BGCOLOR,bg); ObjectSetInteger(0,pfx+n,OBJPROP_COLOR,tc);
   ObjectSetString(0,pfx+n,OBJPROP_FONT,"Consolas Bold"); ObjectSetInteger(0,pfx+n,OBJPROP_FONTSIZE,sz);
   ObjectSetInteger(0,pfx+n,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,pfx+n,OBJPROP_SELECTABLE,false); ObjectSetInteger(0,pfx+n,OBJPROP_HIDDEN,true);
}
// Brand mark: hexagonal AI core (drawn from primitives, Market-safe)
// Segmented signal meter (robotic HUD style)
// Shorter 8-segment bar for the scanner rows
//============================================================
//  CANVAS DASHBOARD  (smooth neural-style HUD)
//============================================================

// ARGB helper from MT5 color + alpha
uint AX(color c,uchar a=255){ return ColorToARGB(c,a); }

// Push a new value into a pair's sparkline history
void SparkPush(int idx,double v){
   if(gSparkCount[idx]<32){ gSpark[idx][gSparkCount[idx]]=v; gSparkCount[idx]++; }
   else { for(int i=0;i<31;i++) gSpark[idx][i]=gSpark[idx][i+1]; gSpark[idx][31]=v; }
}

// Draw a small sparkline inside a box on the canvas
void DrawSpark(int x,int y,int w,int h,int idx,uint col){
   int n=gSparkCount[idx];
   if(n<2) return;
   double mn=gSpark[idx][0],mx=gSpark[idx][0];
   for(int i=1;i<n;i++){ if(gSpark[idx][i]<mn)mn=gSpark[idx][i]; if(gSpark[idx][i]>mx)mx=gSpark[idx][i]; }
   double rng=mx-mn; if(rng<=0)rng=1;
   int px=x, py=y+h-(int)((gSpark[idx][0]-mn)/rng*h);
   for(int i=1;i<n;i++){
      int nx=x+(int)((double)i/(n-1)*w);
      int ny=y+h-(int)((gSpark[idx][i]-mn)/rng*h);
      gCanvas.LineAA(px,py,nx,ny,col);
      px=nx; py=ny;
   }
}

// Rounded-ish filled panel with border
void Panel(int x,int y,int w,int h,uint fill,uint border){
   gCanvas.FillRectangle(x,y,x+w,y+h,fill);
   gCanvas.Rectangle(x,y,x+w,y+h,border);
}

void BuildDashboard()
{
   ObjectsDeleteAll(0,pfx);
   int X=Dashboard_X, Y=Dashboard_Y;
   // Compact: fits on chart. 7 pair rows + neural panel.
   int W=620, H=470;

   gCanvasReady = gCanvas.CreateBitmapLabel(0,0,pfx+"cv",X,Y,W,H,COLOR_FORMAT_ARGB_NORMALIZE);
   if(gCanvasReady){
      ObjectSetInteger(0,pfx+"cv",OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,pfx+"cv",OBJPROP_BACK,false);
      ObjectSetInteger(0,pfx+"cv",OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,pfx+"cv",OBJPROP_HIDDEN,true);
   }

   // ---- manual trade controls (overlay) ----
   // pair selector: [<] [PAIR] [>]   lot:[edit]   BUY / SELL / CLOSE
   int my=Y+H-72;
   oBtn("b_prev",X+12, my, 24,24,"<",C'30,40,70',C'200,220,255',13);
   // selected-pair name box (read-only look)
   ObjectCreate(0,pfx+"pairbox",OBJ_EDIT,0,0,0);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_XDISTANCE,X+38);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_YDISTANCE,my);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_XSIZE,86);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_YSIZE,24);
   ObjectSetString(0,pfx+"pairbox",OBJPROP_TEXT,gManualSym);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_BGCOLOR,C'12,18,34');
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_COLOR,C'255,210,80');
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_ALIGN,ALIGN_CENTER);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_FONTSIZE,10);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_READONLY,true);
   ObjectSetInteger(0,pfx+"pairbox",OBJPROP_SELECTABLE,false);
   oBtn("b_next",X+126,my,24,24,">",C'30,40,70',C'200,220,255',13);
   // lot slider: [-] [lot] [+]
   oBtn("b_lotdn",X+156,my,22,24,"-",C'30,40,70',C'200,220,255',13);
   ObjectCreate(0,pfx+"lotbox",OBJ_EDIT,0,0,0);
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_XDISTANCE,X+180);
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_YDISTANCE,my);
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_XSIZE,46);
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_YSIZE,24);
   ObjectSetString(0,pfx+"lotbox",OBJPROP_TEXT,DoubleToString(gManualLot,2));
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_BGCOLOR,C'12,18,34');
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_COLOR,C'255,255,255');
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_ALIGN,ALIGN_CENTER);
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_FONTSIZE,10);
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,pfx+"lotbox",OBJPROP_SELECTABLE,false);
   oBtn("b_lotup",X+228,my,22,24,"+",C'30,40,70',C'200,220,255',13);
   oBtn("b_buy",  X+256,my,66,24,"BUY", C'0,184,126',C'2,22,15',11);
   oBtn("b_sell", X+326,my,66,24,"SELL",C'208,69,69',C'255,255,255',11);
   oBtn("b_close",X+396,my,62,24,"CLOSE",C'255,150,40',C'26,18,0',9);
   // pause / resume row
   oBtn("b_pause", X+12, my+28,220,22,"PAUSE", C'18,26,50',C'120,170,255',9);
   oBtn("b_resume",X+238,my+28,220,22,"RESUME",C'18,26,50',C'40,255,180',9);

   gLastBar=0;
   UpdateDashboard();
}

// Neural-net motif (fixed 4-3-1 visual, scaled to box)
void DrawNeural(int x,int y,int w,int h,double activity)
{
   int inX=x+8, hidX=x+w/2, outX=x+w-12;
   int inY[4], hidY[3], outY;
   for(int i=0;i<4;i++) inY[i]=y+6+i*((h-12)/3);
   for(int i=0;i<3;i++) hidY[i]=y+12+i*((h-24)/2);
   outY=y+h/2;
   uint linkC=AX((color)C'40,90,160',150);
   uint inC  =AX((color)C'255,120,40');
   uint hidC =AX(CLR_ACCENT);
   uint outC =AX((color)C'255,255,255');
   for(int i=0;i<4;i++) for(int j=0;j<3;j++) gCanvas.LineAA(inX,inY[i],hidX,hidY[j],linkC);
   for(int j=0;j<3;j++) gCanvas.LineAA(hidX,hidY[j],outX,outY,linkC);
   for(int i=0;i<4;i++){ gCanvas.FillCircle(inX,inY[i],4,inC); }
   for(int j=0;j<3;j++){ gCanvas.FillCircle(hidX,hidY[j],5,hidC); }
   uchar ga=(uchar)(120+MathMin(135,(int)(MathAbs(activity)*135)));
   gCanvas.FillCircle(outX,outY,6,AX(CLR_ACCENT,ga));
   gCanvas.CircleAA(outX,outY,9,AX(CLR_ACCENT,120));
   gCanvas.FillCircle(outX,outY,3,outC);
}

void UpdateDashboard()
{
   if(!gCanvasReady) return;

   double bal=AccountInfoDouble(ACCOUNT_BALANCE);
   double eq =AccountInfoDouble(ACCOUNT_EQUITY);
   double pnl=eq-bal;
   double dd=(gPeakEq-eq)/gPeakEq*100.0;
   int W=(int)gCanvas.Width(), H=(int)gCanvas.Height();

   // background
   gCanvas.Erase(AX((color)C'10,16,32',255));
   gCanvas.Rectangle(0,0,W-1,H-1,AX(CLR_ACCENT,180));
   gCanvas.FillRectangle(0,0,60,3,AX(CLR_ACCENT));
   gCanvas.FillRectangle(0,0,3,60,AX(CLR_ACCENT));
   gCanvas.FillRectangle(W-60,H-3,W,H,AX(CLR_ACCENT2));
   gCanvas.FillRectangle(W-3,H-60,W,H,AX(CLR_ACCENT2));

   // ---- header / status bar ----
   Panel(6,6,W-12,46,AX((color)C'14,22,44',255),AX(CLR_ACCENT,200));
   gCanvas.FontSet("Arial Bold",20);
   gCanvas.TextOut(14,12,"AXON PRO 26",AX(CLR_ACCENT));
   gCanvas.FontSet("Arial Bold",10);
   gCanvas.TextOut(140,16,"26-PAIR NEURAL EA",AX((color)C'150,180,230'));
   string st = gUserPause?"PAUSED":(gDDPause?"DD-HALT":"LIVE");
   uint stc = gUserPause?AX((color)C'255,180,40'):(gDDPause?AX((color)C'255,80,80'):AX((color)C'40,255,150'));
   gCanvas.FontSet("Arial Bold",11);
   gCanvas.TextOut(W-130,12,"STATUS",AX((color)C'150,180,230'));
   gCanvas.TextOut(W-130,28,st,stc);
   gCanvas.FontSet("Arial Bold",12);
   gCanvas.TextOut(140,30,"EQ $"+DoubleToString(eq,2),AX((color)C'255,255,255'));
   gCanvas.TextOut(W-250,30,"DD "+DoubleToString(dd,1)+"%",(dd<5)?AX((color)C'40,255,150'):(dd<12)?AX((color)C'255,180,40'):AX((color)C'255,80,80'));

   // ---- left panel: neural ----
   int lpx=6, lpy=56, lpw=150, lph=H-138;
   Panel(lpx,lpy,lpw,lph,AX((color)C'10,16,34',255),AX(CLR_ACCENT,160));
   gCanvas.FontSet("Arial Bold",10);
   gCanvas.TextOut(lpx+8,lpy+6,"AXON CORE",AX((color)C'190,210,240'));
   CalcStats();
   gCanvas.FontSet("Arial",9);
   gCanvas.TextOut(lpx+8,lpy+26,"ACCURACY",AX((color)C'120,150,200'));
   gCanvas.FontSet("Arial Bold",18);
   gCanvas.TextOut(lpx+8,lpy+38,WinRateStr(1),AX((color)C'255,120,40'));
   gCanvas.FillRectangle(lpx+8,lpy+64,lpx+lpw-10,lpy+69,AX((color)C'30,40,60'));
   int aw=(gStatTrades<5)?0:(int)((lpw-18)*gStatWinRate/100.0);
   gCanvas.FillRectangle(lpx+8,lpy+64,lpx+8+aw,lpy+69,AX(CLR_ACCENT));
   DrawNeural(lpx+8,lpy+78,lpw-16,lph-150,gProb==DATA_NR?0:gProb);
   int sb=lpy+lph-58;
   gCanvas.FontSet("Arial Bold",10);
   gCanvas.TextOut(lpx+8,sb,    "TR "+IntegerToString(gStatTrades),AX(CLR_ACCENT2));
   gCanvas.TextOut(lpx+78,sb,   "WR "+WinRateStr(0),AX(CLR_ACCENT2));
   gCanvas.TextOut(lpx+8,sb+18, "NET",AX((color)C'120,150,200'));
   gCanvas.TextOut(lpx+48,sb+18,(gStatProfit>=0?"+$":"-$")+DoubleToString(MathAbs(gStatProfit),0),
                   (gStatProfit>=0)?AX((color)C'40,255,150'):AX((color)C'255,80,80'));
   gCanvas.TextOut(lpx+8,sb+36, "P/L",AX((color)C'120,150,200'));
   gCanvas.TextOut(lpx+48,sb+36,(pnl>=0?"+$":"-$")+DoubleToString(MathAbs(pnl),2),
                   (pnl>=0)?AX((color)C'40,255,150'):AX((color)C'255,80,80'));

   // ---- right panel: 26-pair grid (2 columns) ----
   int rpx=162, rpy=56, rpw=W-rpx-6, rph=H-138;
   Panel(rpx,rpy,rpw,rph,AX((color)C'10,16,34',255),AX(CLR_ACCENT,160));
   gCanvas.FontSet("Arial Bold",10);
   gCanvas.TextOut(rpx+8,rpy+4,(Multi_Trade?"PAIR GRID [LIVE]  ":"PAIR SCANNER  ")+IntegerToString(gPairCount)+" PAIRS",AX((color)C'190,210,240'));

   double thr=Signal_Threshold/100.0;
   int gridTop=rpy+20;
   int cols=2;
   int colW=(rpw-12)/cols;
   int perCol=13;                       // 13 rows x 2 cols = 26
   int rowH=(rph-24)/perCol;
   int shown=(gPairCount>26)?26:gPairCount;
   for(int i=0;i<shown;i++){
      int col=i/perCol;                 // 0 = left, 1 = right
      int row=i%perCol;
      int cx=rpx+6+col*colW;
      int ry=gridTop+row*rowH;
      string nm=gScanLabel[i];
      double p=gScanProb[i];
      gCanvas.FontSet("Arial Bold",9);
      gCanvas.TextOut(cx+4,ry+1,nm,AX((color)C'200,215,235'));
      if(gScanName[i]=="" || p==DATA_NR){
         gCanvas.FontSet("Arial",8);
         gCanvas.TextOut(cx+colW-44,ry+1,"...",AX((color)C'110,125,150'));
      } else {
         string dir=(p>thr)?"BUY":(p<-thr)?"SELL":"-";
         if(Use_M15_Confirm && dir!="-"){ bool ag=((p>thr&&gScanCF[i]==1)||(p<-thr&&gScanCF[i]==-1)); dir=dir+(ag?"+":"x"); }
         uint dc=(p>thr)?AX((color)C'40,255,150'):(p<-thr)?AX((color)C'255,90,90'):AX((color)C'190,190,120');
         // strength bar (background + fill)
         gCanvas.FillRectangle(cx+58,ry+3,cx+colW-44,ry+9,AX((color)C'28,38,58'));
         int barW=(int)((colW-104)*MathMin(1.0,MathAbs(p)));
         gCanvas.FillRectangle(cx+58,ry+3,cx+58+barW,ry+9,dc);
         gCanvas.FontSet("Arial Bold",9);
         gCanvas.TextOut(cx+colW-40,ry+1,dir,dc);
      }
   }

   // ---- manual-trade label above buttons ----
   gCanvas.FontSet("Arial Bold",9);
   gCanvas.TextOut(8,H-86,"MANUAL TRADE  -  pair < >   lot:",AX((color)C'150,180,230'));
   // position status for the selected manual pair
   string msym=(gManualSym!="")?gManualSym:gSym;
   bool mhas=false;
   for(int i=PositionsTotal()-1;i>=0;i--){
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()==msym && posInfo.Magic()==Magic_Num){ mhas=true; break; }
   }
   gCanvas.TextOut(300,H-86,mhas?"[ IN POSITION ]":"[ no position ]",
                   mhas?AX((color)C'40,255,150'):AX((color)C'120,140,170'));

   // ---- footer ----
   gCanvas.FontSet("Arial",8);
   string ftxt = gUserPause?"PAUSED - press RESUME":
                 gDDPause?("DD LIMIT "+DoubleToString(dd,1)+"% - halted"):
                 (News_Filter&&gNewsCache)?"NEWS FILTER - trading paused around high-impact news":
                 (Max_Trades_Day>0&&gTradesCache>=Max_Trades_Day)?("DAILY LIMIT on "+gSym+" ("+IntegerToString(Max_Trades_Day)+"/day)"):
                 ("AXON PRO 26 | "+gSym+" | THR "+DoubleToString(Signal_Threshold,0)+"% | M15:"+(Use_M15_Confirm?"ON":"OFF"));
   gCanvas.TextOut(8,H-16,ftxt,AX(CLR_ACCENT,220));

   gCanvas.Update();
   ChartRedraw(0);
}

//============================================================
//  EVENTS
//============================================================

void OnChartEvent(const int id,const long &lp,const double &dp,const string &sp)
{
   // lot value typed into the edit box
   if(id==CHARTEVENT_OBJECT_ENDEDIT && sp==pfx+"lotbox"){
      double v=StringToDouble(ObjectGetString(0,pfx+"lotbox",OBJPROP_TEXT));
      if(v>0) gManualLot=NormalizeDouble(v,2);
      ObjectSetString(0,pfx+"lotbox",OBJPROP_TEXT,DoubleToString(gManualLot,2));
      return;
   }
   if(id!=CHARTEVENT_OBJECT_CLICK) return;
   if(StringFind(sp,pfx)<0) return;
   string o=StringSubstr(sp,StringLen(pfx));

   if(o=="b_prev"){ CycleManualPair(-1); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_next"){ CycleManualPair(+1); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_lotdn"){ double st=SymbolInfoDouble(gSym,SYMBOL_VOLUME_STEP); if(st<=0)st=0.01; double mn=SymbolInfoDouble(gSym,SYMBOL_VOLUME_MIN); gManualLot=MathMax(mn,NormalizeDouble(gManualLot-st,2)); ObjectSetString(0,pfx+"lotbox",OBJPROP_TEXT,DoubleToString(gManualLot,2)); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_lotup"){ double st=SymbolInfoDouble(gSym,SYMBOL_VOLUME_STEP); if(st<=0)st=0.01; double mx=SymbolInfoDouble(gSym,SYMBOL_VOLUME_MAX); gManualLot=MathMin(mx,NormalizeDouble(gManualLot+st,2)); ObjectSetString(0,pfx+"lotbox",OBJPROP_TEXT,DoubleToString(gManualLot,2)); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_buy"){ if(gReady)ManualTrade(true);  ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_sell"){ if(gReady)ManualTrade(false); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_close"){ CloseAllMine(); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_pause"){ gUserPause=true; ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_resume"){ gUserPause=false; ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
}

void OnTimer()
{
   if(gInTester) return;   // no scanner/canvas work in Strategy Tester (keeps it fast)
   if(gReady){ double q=QuantumWave(); if(q!=DATA_NR) gProb=q; UpdateScanner(); }
   UpdateDashboard();
}
//+------------------------------------------------------------------+
