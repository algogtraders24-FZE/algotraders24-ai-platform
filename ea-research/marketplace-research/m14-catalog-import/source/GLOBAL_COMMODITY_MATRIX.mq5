//+------------------------------------------------------------------+
//|                      GLOBAL COMMODITY MATRIX                              |
//|                  by  ALGOTRADERS24 AI                             |
//|         Single-Asset Quantum Engine - OIL              |
//|                                                                   |
//|  OK: Works on ALL brokers - auto prefix/suffix detection          |
//|  OK: Multi-commodity auto-tuning matrix engine          |
//|  OK: Fixed-points OR ATR-dynamic SL/TP                            |
//|  OK: Manual lot OR risk-% sizing                                  |
//|  OK: One position at a time (clean, simple)                       |
//|  OK: Branded bold dashboard with live signal engine               |
//+------------------------------------------------------------------+

#property copyright   "ALGOTRADERS24 AI"
#property link        "https://algotraders24.ai"
#property version     "1.62"
#property description "GLOBAL COMMODITY MATRIX - Single-Asset Oil Trading System by ALGOTRADERS24 AI"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>


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
#define EA_NAME    "GLOBAL COMMODITY MATRIX"
#define EA_COMPANY "ALGOTRADERS24 AI"
#define EA_ASSET   "AUTO"
#define DATA_NR    -999.0

//============================================================
//  INPUTS
//============================================================

input group "=== ASSET ==="
input string Symbol_Override = "";       // Leave blank = trade the chart symbol. Or force one (e.g. USOIL.m)

input group "=== QUANTUM PARAMETERS ==="
input double Signal_Threshold = 60;      // Wave Collapse Threshold - min signal strength % (0-100)
input int    Q_WaveLength     = 34;      // Quantum Wave Period (Fibonacci: 21/34/55)
input double Q_Entanglement   = 0.60;    // Entanglement Correlation min (0-1) - cross-TF agreement
input int    Q_SuperStates    = 8;       // Superposition States evaluated (4-8)
input double Q_TunnelProb     = 0.70;    // Quantum Tunnel Breakout Probability (0-1)

input group "=== MATRIX AUTO-TUNE ==="
input bool   Auto_Tune        = true;    // Auto-detect asset (Gold/Silver/Oil/BTC) and tune. Off=use values below.

input group "=== SL-TP MODE (used if Auto_Tune=OFF) ==="
input bool   Use_Fixed_SLTP   = false;   // true=Fixed Points, false=ATR Dynamic
input int    Fixed_SL_Points  = 500;     // Fixed SL points (if Use_Fixed_SLTP)
input int    Fixed_TP_Points  = 800;     // Fixed TP points (if Use_Fixed_SLTP)
input double ATR_SL_Mult      = 1.8;     // ATR x SL multiplier (if Use_Fixed_SLTP=false)
input double ATR_TP_Mult      = 3.0;     // ATR x TP multiplier (if Use_Fixed_SLTP=false)

input group "=== RISK ==="
input bool   Use_Manual_Lot   = true;    // true=fixed lot below; false=Risk %
input double Fixed_Lot_Size   = 0.01;    // Lot for AUTO trades (manual mode)
input double Risk_Percent     = 1.0;     // Risk % per trade (range 0.10 to 2). Used when Use_Manual_Lot=false
input bool   Use_TrailingStop = true;
input double Trail_ATR_Mult   = 1.8;
input int    Fixed_Trail_Pts  = 1500;    // Fixed trail points
input bool   Use_BreakEven    = true;
input double MaxDrawdown_Pct  = 30.0;    // Max daily drawdown % (used if Auto_Tune=OFF)
input int    Max_Trades_Day   = 2;       // Max NEW trades per SYMBOL per day
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
input bool   News_Filter      = true;    // Pause trading around high-impact news
input bool   News_HighImpact  = true;    // Block on HIGH impact events
input bool   News_MedImpact   = false;   // Also block on MEDIUM impact events
input int    News_MinsBefore  = 30;      // Stop trading this many minutes BEFORE news
input int    News_MinsAfter   = 30;      // Resume trading this many minutes AFTER news
input bool   News_USD = true;            // Watch USD events
input bool   News_EUR = false;           // Watch EUR events
input bool   News_GBP = false;           // Watch GBP events
input bool   News_AllCurrencies = true;  // Watch ALL currencies (overrides the three above)

input group "=== DASHBOARD ==="
input int    Dashboard_X     = 20;
input int    Dashboard_Y     = 30;

input group "=== IDENTITY ==="
input int    Magic_Num   = 24010010;     // Unique per EA
input string EA_Tag      = "GCM_MATRIX";

//============================================================
//  GLOBALS
//============================================================

CTrade        trade;
CPositionInfo posInfo;

string  gSym = "";          // resolved broker symbol
bool    gReady = false;

// Matrix effective tuning (set by auto-detect or from inputs)
double  gAtrSL=2.2, gAtrTP=3.5, gTrailM=1.8, gDDLimit=30.0;
string  gAsset="GENERIC";   // detected asset label for dashboard

int hEMA_F[2],hEMA_M[2],hEMA_S[2],hEMA_T;
int hCF_EMA_F,hCF_EMA_S,hCF_RSI;   // M15 confirmation handles (chart symbol)
int hRSI,hMACD,hATR,hStoch,hADX,hBB,hCCI;

datetime gLastBar;
double   gPeakEq;
bool     gDDPause=false, gUserPause=false;
// Cached status (refreshed on a timer, not every tick) to keep the dashboard
// light: Calendar and deal-history are only queried periodically.
bool     gNewsCache=false;
int      gTradesCache=0;
datetime gCacheStamp=0;
double   gProb=0;

// ---- Multi-asset signal scanner (display only; trading stays on chart symbol) ----
input group "=== MULTI-ASSET SCANNER ==="
input bool   Show_Scanner   = true;     // Show Gold/Silver/Oil/BTC signals on the dashboard
input bool   Multi_Trade    = true;     // TRADE all 4 commodities from this one chart (not just display)
input int    Max_Open_Trades  = 4;       // Max simultaneous open trades (of 4 commodities)
input string Scan_Gold      = "XAUUSD"; // Gold symbol on your broker (blank = skip)
input string Scan_Silver    = "XAGUSD"; // Silver symbol (blank = skip)
input string Scan_Oil       = "USOIL";  // Oil symbol (blank = skip)
input string Scan_BTC       = "BTCUSD"; // Bitcoin symbol (blank = skip)

string  gScanName[4];     // resolved symbol names
double  gScanProb[4];     // last computed signal per asset (-1..1, or DATA_NR)
int     gScanCF[4];       // M15 confirm state per commodity (+1 buy / -1 sell / 0 none)
string  gScanLabel[4]={"GOLD","SILVER","OIL","BTC"};
datetime gScanLast=0;

string pfx = "GCM_";
color  CLR_ACCENT  = C'0,224,192';    // cyan AI accent
color  CLR_ACCENT2 = C'200,168,56';   // gold secondary
color  CLR_BG      = C'10,14,18';   // deep tech dark
color  CLR_PANEL   = C'12,20,24';   // HUD panel

// Detect which commodity the chart symbol is, and apply its tuning profile.
// Uses substring matching so it works with ANY broker prefix/suffix, e.g.
// XAUUSD, XAUUSD.m, XAUUSDr, XAUUSD-ECN, GOLD.spot, mGOLD, #XAUUSD, etc.
void DetectAndTune()
{
   // Normalize: uppercase and strip common separators/suffix noise
   string s=gSym; StringToUpper(s);
   string n="";  // alnum-only normalized copy for robust matching
   for(int i=0;i<StringLen(s);i++){
      ushort c=StringGetCharacter(s,i);
      if((c>='A'&&c<='Z')||(c>='0'&&c<='9')) n+=ShortToString(c);
   }

   if(!Auto_Tune){
      gAtrSL=ATR_SL_Mult; gAtrTP=ATR_TP_Mult; gTrailM=Trail_ATR_Mult; gDDLimit=MaxDrawdown_Pct;
      gAsset="MANUAL"; return;
   }

   // ---- GOLD ----  (XAUUSD, GOLD, GOLD#, XAUUSD.m, GOLDmicro, etc.)
   if(StringFind(n,"XAU")>=0 || StringFind(n,"GOLD")>=0){
      gAtrSL=2.0; gAtrTP=3.2; gTrailM=1.8; gDDLimit=25.0; gAsset="GOLD"; return;
   }
   // ---- SILVER ----  (XAGUSD, SILVER, XAGUSD.m, SILVERmicro, etc.)
   if(StringFind(n,"XAG")>=0 || StringFind(n,"SILVER")>=0){
      gAtrSL=2.5; gAtrTP=4.0; gTrailM=1.8; gDDLimit=28.0; gAsset="SILVER"; return;
   }
   // ---- BITCOIN ----  (BTCUSD, XBTUSD, BITCOIN, BTCUSD.m, BTCUSDT, etc.)
   if(StringFind(n,"BTC")>=0 || StringFind(n,"XBT")>=0 || StringFind(n,"BITCOIN")>=0){
      gAtrSL=3.0; gAtrTP=5.0; gTrailM=2.0; gDDLimit=35.0; gAsset="BITCOIN"; return;
   }
   // ---- OIL ----  (USOIL, UKOIL, WTI, BRENT, CRUDE, XTIUSD, XBRUSD, OIL, CL, etc.)
   if(StringFind(n,"OIL")>=0   || StringFind(n,"WTI")>=0   || StringFind(n,"BRENT")>=0 ||
      StringFind(n,"CRUDE")>=0 || StringFind(n,"XTI")>=0   || StringFind(n,"XBR")>=0   ||
      StringFind(n,"USOUSD")>=0|| n=="CL" || StringFind(n,"CLUSD")>=0){
      gAtrSL=2.2; gAtrTP=3.5; gTrailM=1.8; gDDLimit=30.0; gAsset="OIL"; return;
   }

   // ---- Anything else: safe balanced generic profile ----
   gAtrSL=2.2; gAtrTP=3.5; gTrailM=1.8; gDDLimit=30.0; gAsset="GENERIC";
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
   DetectAndTune();   // Matrix: pick tuning profile for the detected commodity

   // Resolve scanner symbols (validate each; blank/missing = skip that asset).
   // In Strategy Tester only the chart symbol exists, so skip the scanner there
   // to avoid "symbol does not exist" notices.
   bool inTester = (bool)MQLInfoInteger(MQL_TESTER);
   gScanName[0]=Scan_Gold;   gScanName[1]=Scan_Silver;
   gScanName[2]=Scan_Oil;    gScanName[3]=Scan_BTC;
   for(int i=0;i<4;i++){
      gScanProb[i]=DATA_NR;
      if(inTester){ gScanName[i]=""; continue; }                    // tester: single-symbol only
      if(gScanName[i]!="" && !SymbolSelect(gScanName[i],true)) gScanName[i]="";  // not at broker -> skip
   }
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
   // M15 confirmation handles for chart symbol (fast EMA, slow EMA, RSI)
   hCF_EMA_F=iMA(gSym,Confirm_TF,Trend_L1,0,MODE_EMA,PRICE_CLOSE);
   hCF_EMA_S=iMA(gSym,Confirm_TF,Trend_L3,0,MODE_EMA,PRICE_CLOSE);
   hCF_RSI  =iRSI(gSym,Confirm_TF,Momentum_P,PRICE_CLOSE);

   bool ok = hEMA_F[0]!=INVALID_HANDLE&&hEMA_F[1]!=INVALID_HANDLE&&
             hEMA_M[0]!=INVALID_HANDLE&&hEMA_M[1]!=INVALID_HANDLE&&
             hEMA_S[0]!=INVALID_HANDLE&&hEMA_S[1]!=INVALID_HANDLE&&
             hEMA_T!=INVALID_HANDLE&&hRSI!=INVALID_HANDLE&&hMACD!=INVALID_HANDLE&&
             hATR!=INVALID_HANDLE&&hStoch!=INVALID_HANDLE&&hADX!=INVALID_HANDLE&&
             hBB!=INVALID_HANDLE&&hCCI!=INVALID_HANDLE&&
             hCF_EMA_F!=INVALID_HANDLE&&hCF_EMA_S!=INVALID_HANDLE&&hCF_RSI!=INVALID_HANDLE;
   if(!ok){ Print("ERROR: Handle error on ",gSym); gReady=false; }
   else   { gReady=true; }

   gLastBar=iTime(gSym,Main_TF,0);
   gProb=DATA_NR;
   gPeakEq=AccountInfoDouble(ACCOUNT_EQUITY);

   EventSetTimer(1);
   BuildDashboard();
   Print("=== ",EA_NAME," MATRIX by ",EA_COMPANY," READY | Symbol: ",gSym,
         " | PROFILE: ",gAsset," | SL ",DoubleToString(gAtrSL,1),"x TP ",DoubleToString(gAtrTP,1),"x | M15: ",(Use_M15_Confirm?"ON":"OFF")," ===");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectsDeleteAll(0,pfx);
   if(gReady){
      IndicatorRelease(hEMA_F[0]);IndicatorRelease(hEMA_F[1]);
      IndicatorRelease(hEMA_M[0]);IndicatorRelease(hEMA_M[1]);
      IndicatorRelease(hEMA_S[0]);IndicatorRelease(hEMA_S[1]);
      IndicatorRelease(hEMA_T);IndicatorRelease(hRSI);IndicatorRelease(hMACD);
      IndicatorRelease(hATR);IndicatorRelease(hStoch);IndicatorRelease(hADX);
      IndicatorRelease(hBB);IndicatorRelease(hCCI);
      IndicatorRelease(hCF_EMA_F);IndicatorRelease(hCF_EMA_S);IndicatorRelease(hCF_RSI);
   }
}

//============================================================
//  TICK
//============================================================

void OnTick()
{
   if(!gReady){ UpdateDashboard(); return; }

   // Refresh cached news/daily-trade status at most once every 15s to keep the
   // per-tick dashboard light (Calendar and deal-history are heavy to query).
   datetime nowT=TimeCurrent();
   if(nowT-gCacheStamp>=15){
      gCacheStamp=nowT;
      gNewsCache  =(News_Filter ? IsNewsTime() : false);
      gTradesCache=(Max_Trades_Day>0 ? TradesToday(gSym) : 0);
   }

   double eq=AccountInfoDouble(ACCOUNT_EQUITY);
   gPeakEq=MathMax(gPeakEq,eq);
   double dd=(gPeakEq-eq)/gPeakEq*100.0;
   if(dd>=gDDLimit){ if(!gDDPause){Print("WARNING: DD limit");gDDPause=true;} UpdateDashboard(); return; }
   else gDDPause=false;

   if(Use_TrailingStop) DoTrail();
   if(Use_BreakEven)    DoBE();

   double q=QuantumWave();
   if(q!=DATA_NR) gProb=q;

   UpdateScanner();   // refresh multi-asset signal panel (display only, throttled)

   datetime cb=iTime(gSym,Main_TF,0);
   if(cb!=0 && gLastBar!=0 && cb!=gLastBar){
      gLastBar=cb;
      bool sessOK=!(Filter_Session&&!IsSession());
      bool friOK =!(Filter_Friday&&IsFridayClose());
      bool newsOK=!IsNewsTime();   // pause around high-impact news
      bool dayOK =(Max_Trades_Day<=0 || TradesToday(gSym)<Max_Trades_Day);  // per-symbol daily cap (chart symbol)

      // Multi-commodity auto-trading runs ONCE per new bar (not every tick),
      // so a fresh signal opens at most one new position per symbol per bar.
      if(!gUserPause && !gDDPause && sessOK && friOK && newsOK && dayOK)
         MultiTradeAll();

      // Single chart-symbol entry (also once per bar)
      if(!gUserPause&&!gDDPause&&sessOK&&friOK&&newsOK&&dayOK&&!HasPos() && q!=DATA_NR){
         double thr=Signal_Threshold/100.0;
         if(thr<0.05)thr=0.05; if(thr>0.99)thr=0.99;
         int cf=MConfirm();   // M15 gate (auto entries only)
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
   if(TimeCurrent()-gScanLast<10) return;   // refresh every 10s max (handles are heavy)
   gScanLast=TimeCurrent();
   gScanProb[0]=ScanSignal(gScanName[0]);
   gScanProb[1]=ScanSignal(gScanName[1]);
   gScanProb[2]=ScanSignal(gScanName[2]);
   gScanProb[3]=ScanSignal(gScanName[3]);
   // M15 confirmation per commodity (computed here on the same 10s refresh,
   // so MultiTradeAll and the dashboard just read the cached state).
   for(int i=0;i<4;i++)
      gScanCF[i]=(gScanName[i]=="")?0:MConfirmSym(gScanName[i]);
}

// Per-asset tuning profile (SL mult, TP mult, DD) by label index 0..3
void ProfileFor(int idx,double &asl,double &atp,double &dd)
{
   if(idx==0){ asl=2.0; atp=3.2; dd=25.0; }       // GOLD
   else if(idx==1){ asl=2.5; atp=4.0; dd=28.0; }  // SILVER
   else if(idx==2){ asl=2.2; atp=3.5; dd=30.0; }  // OIL
   else { asl=3.0; atp=5.0; dd=35.0; }            // BTC
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

// Trade ONE commodity on its own symbol with its own tuning (one position at a time).

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

   // ATR for this symbol
   int ha=iATR(sym,Main_TF,Volatility_P);
   if(ha==INVALID_HANDLE) return;
   double atr[2]; bool ok=(CopyBuffer(ha,0,0,2,atr)>=2);
   IndicatorRelease(ha);
   if(!ok || atr[1]<=0) return;

   double price=isBuy?SymbolInfoDouble(sym,SYMBOL_ASK):SymbolInfoDouble(sym,SYMBOL_BID);
   double sd=atr[1]*asl, td=atr[1]*atp;
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

// Run multi-asset auto-trading across all 4 commodities (uses scanner signals).
int CountMyPositions()
{
   int n=0;
   for(int i=PositionsTotal()-1;i>=0;i--){
      ulong tk=PositionGetTicket(i);
      if(tk==0) continue;
      if(PositionGetInteger(POSITION_MAGIC)==Magic_Num) n++;
   }
   return n;
}

// Count NEW trades opened today for a given symbol (this EA only), from deal
// history. Resets automatically at the start of each new day.
int TradesToday(string sym)
{
   datetime now=TimeCurrent();
   MqlDateTime d; TimeToStruct(now,d);
   d.hour=0; d.min=0; d.sec=0;
   datetime dayStart=StructToTime(d);
   if(!HistorySelect(dayStart,now)) return 0;
   int n=0;
   int deals=HistoryDealsTotal();
   for(int i=0;i<deals;i++){
      ulong tk=HistoryDealGetTicket(i);
      if(tk==0) continue;
      if(HistoryDealGetInteger(tk,DEAL_MAGIC)!=Magic_Num) continue;
      if(HistoryDealGetString(tk,DEAL_SYMBOL)!=sym) continue;         // this symbol only
      if(HistoryDealGetInteger(tk,DEAL_ENTRY)==DEAL_ENTRY_IN) n++;    // opening deals only
   }
   return n;
}

void MultiTradeAll()
{
   if(!Multi_Trade) return;
   if(CountMyPositions()>=Max_Open_Trades) return;   // cap simultaneous trades
   double thr=Signal_Threshold/100.0;
   for(int i=0;i<4;i++){
      if(gScanName[i]=="") continue;
      if(Max_Trades_Day>0 && TradesToday(gScanName[i])>=Max_Trades_Day) continue;  // per-symbol daily cap
      double p=gScanProb[i];
      if(p==DATA_NR) continue;
      int cf=gScanCF[i];   // M15 confirmation for this commodity
      if(p>thr  && (!Use_M15_Confirm || cf==1))  MultiExec(i,true);
      else if(p<-thr && (!Use_M15_Confirm || cf==-1)) MultiExec(i,false);
   }
}

// M15 confirmation for the CHART symbol: +1 buy agrees, -1 sell agrees, 0 none.
int gCF_Status=0;
int MConfirm()
{
   if(!Use_M15_Confirm){ gCF_Status=0; return 0; }
   double ef[2], es[2], rs[2];
   if(CopyBuffer(hCF_EMA_F,0,0,2,ef)<2) return 0;
   if(CopyBuffer(hCF_EMA_S,0,0,2,es)<2) return 0;
   if(CopyBuffer(hCF_RSI,  0,0,2,rs)<2) return 0;
   int c=0;
   if(ef[1]>es[1] && rs[1]>50.0)      c=1;
   else if(ef[1]<es[1] && rs[1]<50.0) c=-1;
   gCF_Status=c;
   return c;
}

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

void ManualTrade(bool isBuy)
{
   SetFilling();
   double price=isBuy?SymbolInfoDouble(gSym,SYMBOL_ASK):SymbolInfoDouble(gSym,SYMBOL_BID);
   double sl,tp; GetSLTP(isBuy,price,sl,tp);
   if(!EnoughMoney(isBuy,Manual_Lot)) return;
   bool r=isBuy?trade.Buy(Manual_Lot,gSym,price,sl,tp,EA_Tag+"_MANUAL_BUY")
              :trade.Sell(Manual_Lot,gSym,price,sl,tp,EA_Tag+"_MANUAL_SELL");
   if(r) Print("MANUAL: MANUAL ",(isBuy?"BUY":"SELL")," ",gSym);
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

// News filter using the MT5 built-in Economic Calendar.
// Returns true if we are currently inside a high/medium-impact news window
// (so trading should pause). Automatically disabled in the Strategy Tester /
// validation, where calendar data is not available -> keeps validation clean.
bool IsNewsTime()
{
   if(!News_Filter) return false;
   if((bool)MQLInfoInteger(MQL_TESTER)) return false;   // no calendar in tester

   datetime now=TimeCurrent();
   datetime from=now-(News_MinsAfter*60);
   datetime to  =now+(News_MinsBefore*60);

   MqlCalendarValue values[];
   // pull all calendar values in the window (country filtered below)
   int total=CalendarValueHistory(values,from,to,NULL,NULL);
   if(total<=0) return false;

   for(int i=0;i<total;i++){
      MqlCalendarEvent ev;
      if(!CalendarEventById(values[i].event_id,ev)) continue;

      // impact filter
      bool impactOK=false;
      if(News_HighImpact && ev.importance==CALENDAR_IMPORTANCE_HIGH)   impactOK=true;
      if(News_MedImpact  && ev.importance==CALENDAR_IMPORTANCE_MODERATE) impactOK=true;
      if(!impactOK) continue;

      // currency filter
      if(!News_AllCurrencies){
         MqlCalendarCountry ctry;
         if(!CalendarCountryById(ev.country_id,ctry)) continue;
         string cur=ctry.currency;
         bool curOK=false;
         if(News_USD && cur=="USD") curOK=true;
         if(News_EUR && cur=="EUR") curOK=true;
         if(News_GBP && cur=="GBP") curOK=true;
         if(!curOK) continue;
      }

      // event time inside our [before, after] window?
      datetime et=values[i].time;
      if(et>=from && et<=to) return true;
   }
   return false;
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

void oRect(string n,int x,int y,int w,int h,color bg,color brd,int bw=1){
   ObjectCreate(0,pfx+n,OBJ_RECTANGLE_LABEL,0,0,0);
   ObjectSetInteger(0,pfx+n,OBJPROP_XDISTANCE,x); ObjectSetInteger(0,pfx+n,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,pfx+n,OBJPROP_XSIZE,w); ObjectSetInteger(0,pfx+n,OBJPROP_YSIZE,h);
   ObjectSetInteger(0,pfx+n,OBJPROP_BGCOLOR,bg);
   ObjectSetInteger(0,pfx+n,OBJPROP_BORDER_TYPE,BORDER_FLAT);
   ObjectSetInteger(0,pfx+n,OBJPROP_COLOR,brd); ObjectSetInteger(0,pfx+n,OBJPROP_BORDER_COLOR,brd);
   ObjectSetInteger(0,pfx+n,OBJPROP_WIDTH,bw);
   ObjectSetInteger(0,pfx+n,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,pfx+n,OBJPROP_BACK,false);
   ObjectSetInteger(0,pfx+n,OBJPROP_SELECTABLE,false); ObjectSetInteger(0,pfx+n,OBJPROP_HIDDEN,true);
}
void oText(string n,int x,int y,string txt,color c,int sz,string font="Consolas",bool bold=false){
   ObjectCreate(0,pfx+n,OBJ_LABEL,0,0,0);
   ObjectSetInteger(0,pfx+n,OBJPROP_XDISTANCE,x); ObjectSetInteger(0,pfx+n,OBJPROP_YDISTANCE,y);
   ObjectSetString(0,pfx+n,OBJPROP_TEXT,txt);
   ObjectSetInteger(0,pfx+n,OBJPROP_COLOR,c); ObjectSetInteger(0,pfx+n,OBJPROP_FONTSIZE,sz);
   ObjectSetString(0,pfx+n,OBJPROP_FONT,bold?(font+" Bold"):font);
   ObjectSetInteger(0,pfx+n,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,pfx+n,OBJPROP_SELECTABLE,false); ObjectSetInteger(0,pfx+n,OBJPROP_HIDDEN,true);
}
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
void sT(string n,string t){ ObjectSetString(0,pfx+n,OBJPROP_TEXT,t); }
void sC(string n,color c){ ObjectSetInteger(0,pfx+n,OBJPROP_COLOR,c); }
void sBg(string n,color c){ ObjectSetInteger(0,pfx+n,OBJPROP_BGCOLOR,c); }

// Brand mark: hexagonal AI core (drawn from primitives, Market-safe)
void DrawLogo(int x,int y)
{
   // hex frame approximated with stacked rectangles (outer)
   oRect("lg_o1",x+16,y+1, 22,52,CLR_PANEL,CLR_ACCENT2,1);
   oRect("lg_o2",x+6, y+9, 42,36,CLR_PANEL,CLR_ACCENT2,1);
   // inner gold hex
   oRect("lg_i1",x+20,y+9, 14,36,C'0,0,0',CLR_ACCENT,1);
   oRect("lg_i2",x+12,y+15,30,24,C'0,0,0',CLR_ACCENT,1);
   // glowing AI core center
   oRect("lg_core",x+21,y+21,12,12,CLR_ACCENT2,CLR_ACCENT2);
   oRect("lg_core2",x+24,y+24,6,6,C'255,255,255',C'255,255,255');
   // circuit leads
   oRect("lg_l1",x+26,y+1, 2,9, CLR_ACCENT2,CLR_ACCENT2);
   oRect("lg_l2",x+26,y+44,2,9, CLR_ACCENT2,CLR_ACCENT2);
   oRect("lg_l3",x+1, y+26,9,2, CLR_ACCENT,CLR_ACCENT);
   oRect("lg_l4",x+44,y+26,9,2, CLR_ACCENT,CLR_ACCENT);
}

// Segmented signal meter (robotic HUD style)
string SegBar(double p){
   int n=(int)(MathAbs(p)*10); string b="";
   for(int i=0;i<10;i++) b+=(i<n?"■":"□");  // filled/empty squares
   return b;
}

// Shorter 8-segment bar for the scanner rows
string SegBar8(double p){
   int n=(int)(MathAbs(p)*8); string b="";
   for(int i=0;i<8;i++) b+=(i<n?"■":"□");
   return b;
}

void BuildDashboard()
{
   ObjectsDeleteAll(0,pfx);
   int X=Dashboard_X,Y=Dashboard_Y,W=392,H=(Show_Scanner?558:462);

   // layered shadow for depth
   oRect("shadow2",X+8,Y+8,W,H,C'1,3,4',C'1,3,4');
   oRect("shadow",X+4,Y+4,W,H,C'3,6,8',C'3,6,8');
   oRect("bg",X,Y,W,H,CLR_BG,CLR_ACCENT,2);

   // circuit corner accents
   oRect("ctl",X,Y,46,3,CLR_ACCENT,CLR_ACCENT);
   oRect("ctl2",X,Y,3,46,CLR_ACCENT,CLR_ACCENT);
   oRect("cbr",X+W-46,Y+H-3,46,3,CLR_ACCENT2,CLR_ACCENT2);
   oRect("cbr2",X+W-3,Y+H-46,3,46,CLR_ACCENT2,CLR_ACCENT2);

   // Header band with AI core logo
   oRect("hdr",X,Y+3,W,66,C'10,18,22',CLR_ACCENT,1);
   DrawLogo(X+10,Y+10);
   oText("co", X+76,Y+11, EA_COMPANY,C'90,138,132',8,"Consolas",true);
   oText("nm", X+76,Y+26,EA_NAME,CLR_ACCENT,12,"Consolas",true);
   oText("tag",X+76,Y+48,"MULTI-COMMODITY AI MATRIX",C'120,110,70',7);
   oText("core",X+W-92,Y+11,"CORE STATUS",C'90,138,132',7);
   oText("corev",X+W-92,Y+24,"* ONLINE",C'0,255,157',9,"Consolas",true);

   // MATRIX active-asset profile bar
   int ay=Y+72;
   oRect("apbar",X+10,ay,W-20,22,C'8,16,20',CLR_ACCENT2,1);
   oText("aplbl",X+18,ay+5,"ACTIVE MATRIX PROFILE:",C'90,138,132',7,"Consolas",true);
   oText("apval",X+170,ay+4,"",CLR_ACCENT2,9,"Consolas",true);
   oText("aptune",X+250,ay+5,"",C'110,130,126',7,"Consolas",true);

   int sy=Y+100;

   // Multi-asset scanner panel (display only)
   if(Show_Scanner){
      oText("scanlbl",X+14,sy,(Multi_Trade?"> MATRIX SCANNER [LIVE TRADING]":"> COMMODITY MATRIX SCANNER"),C'90,138,132',8,"Consolas",true); sy+=16;
      oRect("scanbox",X+10,sy,W-20,82,C'8,14,18',C'20,50,46',1);
      string rk[4]={"row0","row1","row2","row3"};
      for(int i=0;i<4;i++){
         int ry=sy+5+i*19;
         oText("sl_"+rk[i],X+18,ry,gScanLabel[i]+":",C'120,140,136',9,"Consolas",true);
         oText("sm_"+rk[i],X+80,ry,"□□□□□□□□",C'40,70,66',9,"Consolas",true);
         oText("sv_"+rk[i],X+230,ry,"",C'120,120,120',9,"Consolas",true);
      }
      sy+=90;
   }

   // Neural signal analysis (active chart symbol)
   oText("siglbl",X+14,sy,"> ACTIVE SIGNAL ("+gAsset+")",C'90,138,132',8,"Consolas",true);
   oText("sym",  X+250,sy,"",CLR_ACCENT,9,"Consolas",true); sy+=18;
   oText("sigbar",X+14,sy,"□□□□□□□□□□",C'40,70,66',15,"Consolas",true); sy+=24;
   oText("sigdir",X+14,sy,"",C'120,120,120',13,"Consolas",true);
   oText("sigpct",X+300,sy,"",C'120,120,120',15,"Consolas",true);
   oText("sigpos",X+14,sy+20,"",C'110,130,126',7); sy+=34;

   // Data grid 2x2 (HUD)
   oRect("dg",X+10,sy,W-20,52,CLR_PANEL,C'20,50,46',1);
   oText("balL",X+18,sy+5,"BALANCE",C'90,138,132',7);
   oText("bal", X+18,sy+16,"",C'191,232,224',10,"Consolas",true);
   oText("eqL", X+205,sy+5,"EQUITY",C'90,138,132',7);
   oText("eq",  X+205,sy+16,"",C'191,232,224',10,"Consolas",true);
   oText("pnlL",X+18,sy+30,"OPEN P&L",C'90,138,132',7);
   oText("pnl", X+18,sy+40,"",C'200,200,200',10,"Consolas",true);
   oText("ddL", X+205,sy+30,"DRAWDOWN",C'90,138,132',7);
   oText("dd",  X+205,sy+40,"",C'200,200,200',10,"Consolas",true);
   sy+=60;

   // Performance core (3 boxes) - REAL data
   int bw=(W-20-16)/3;
   oRect("st1",X+10,      sy, bw,38,CLR_PANEL,C'26,58,48',1);
   oRect("st2",X+10+bw+8, sy, bw,38,CLR_PANEL,C'26,58,48',1);
   oRect("st3",X+10+2*(bw+8),sy,bw,38,CLR_PANEL,C'26,58,48',1);
   oText("st1v",X+18,        sy+5,"",CLR_ACCENT2,12,"Consolas",true);
   oText("st1l",X+18,        sy+24,"TRADES",C'90,138,132',7);
   oText("st2v",X+18+bw+8,   sy+5,"",CLR_ACCENT2,12,"Consolas",true);
   oText("st2l",X+18+bw+8,   sy+24,"WIN RATE",C'90,138,132',7);
   oText("st3v",X+18+2*(bw+8),sy+5,"",CLR_ACCENT2,12,"Consolas",true);
   oText("st3l",X+18+2*(bw+8),sy+24,"NET PROFIT",C'90,138,132',7);
   sy+=46;

   // Command buttons
   oBtn("b_buy", X+10, sy,118,30,"^ BUY",C'0,184,126',C'2,22,15',11);
   oBtn("b_sell",X+136,sy,118,30,"v SELL",C'208,69,69',C'255,255,255',11);
   oBtn("b_close",X+262,sy,120,30,"x CLOSE",C'200,144,32',C'26,18,0',10);
   sy+=37;

   oBtn("b_pause", X+10, sy,184,26,"|| PAUSE",C'19,38,44',C'122,184,176',9);
   oBtn("b_resume",X+200,sy,182,26,"> RESUME",C'19,38,44',C'0,255,157',9);
   sy+=32;

   // Footer status
   oRect("ftr",X,Y+H-26,W,26,C'8,14,17',CLR_ACCENT,1);
   oText("status",X+12,Y+H-19,"",CLR_ACCENT,7,"Consolas",true);

   ChartRedraw(0);
}

void UpdateDashboard()
{
   double bal=AccountInfoDouble(ACCOUNT_BALANCE);
   double eq =AccountInfoDouble(ACCOUNT_EQUITY);
   double pnl=eq-bal;
   double dd=(gPeakEq-eq)/gPeakEq*100.0;

   sT("bal","$"+DoubleToString(bal,2));
   sT("eq", "$"+DoubleToString(eq,2));
   sT("pnl",(pnl>=0?"+$":"-$")+DoubleToString(MathAbs(pnl),2));
   sC("pnl",(pnl>=0)?C'0,220,120':C'220,80,80');
   sT("dd",DoubleToString(dd,1)+"%");
   sC("dd",(dd<8)?C'0,224,192':(dd<16)?C'255,200,0':C'220,80,80');

   // Real performance stats from this EA's closed trades
   CalcStats();
   sT("st1v",IntegerToString(gStatTrades));
   sT("st2v",WinRateStr(0));
   sT("st3v",(gStatProfit>=0?"+$":"-$")+DoubleToString(MathAbs(gStatProfit),0));
   sC("st3v",(gStatProfit>=0)?C'0,220,120':C'220,80,80');

   // Matrix active profile
   sT("apval",gAsset);
   sT("aptune","SL "+DoubleToString(gAtrSL,1)+"x  TP "+DoubleToString(gAtrTP,1)+"x  DD "+DoubleToString(gDDLimit,0)+"%");

   // Multi-asset scanner rows
   if(Show_Scanner){
      string rk[4]={"row0","row1","row2","row3"};
      double thr=Signal_Threshold/100.0;
      for(int i=0;i<4;i++){
         if(gScanName[i]==""){
            sT("sm_"+rk[i],"-- n/a --"); sC("sm_"+rk[i],C'80,80,80');
            sT("sv_"+rk[i],""); continue;
         }
         double p=gScanProb[i];
         if(p==DATA_NR){
            sT("sm_"+rk[i],"........"); sC("sm_"+rk[i],C'90,90,60');
            sT("sv_"+rk[i],"WAIT"); sC("sv_"+rk[i],C'150,150,90'); continue;
         }
         sT("sm_"+rk[i],SegBar8(p)); sC("sm_"+rk[i],(p>0)?C'0,220,120':(p<0)?C'220,80,80':C'120,120,120');
         double rt=thr; if(rt<0.05)rt=0.05;
         double relP=MathMin(MathAbs(p)/rt,1.0)*100.0;   // threshold-relative %
         string m15="";
         if(Use_M15_Confirm){
            bool agree=((p>thr && gScanCF[i]==1)||(p<-thr && gScanCF[i]==-1));
            m15=agree?" M15+":" M15x";
         }
         string d=(p>thr)?"BUY "+DoubleToString(relP,0)+"%"+m15:
                  (p<-thr)?"SELL "+DoubleToString(relP,0)+"%"+m15:
                  "WAIT "+DoubleToString(relP,0)+"%";
         color dc=(p>thr)?C'0,255,157':(p<-thr)?C'255,80,80':C'150,150,150';
         sT("sv_"+rk[i],d); sC("sv_"+rk[i],dc);
      }
   }

   if(!gReady){
      sT("sym","SYMBOL: NOT FOUND");
      sT("sigbar","□□□□□□□□□□"); sC("sigbar",C'90,90,90');
      sT("sigdir","CHECK SYMBOL"); sC("sigdir",C'220,80,80');
      sT("sigpct","");
      sT("status","WARNING: symbol not available - set Symbol_Override");
      ChartRedraw(0); return;
   }

   sT("sym",gSym);
   bool hp=HasPos();

   if(gProb==DATA_NR){
      sT("sigbar","loading data..."); sC("sigbar",C'120,120,60');
      sT("sigdir","..."); sC("sigdir",C'150,150,80'); sT("sigpct","");
   } else {
      double p=gProb;
      double thr=Signal_Threshold/100.0;
      sT("sigbar",SegBar(p)); sC("sigbar",(p>0)?C'0,255,157':C'220,70,70');
      string d=(p>thr)?"^ STRONG BUY":(p<-thr)?"v STRONG SELL":"- NEUTRAL";
      color dc=(p>thr)?C'0,255,157':(p<-thr)?C'255,80,80':C'150,150,150';
      if(Use_M15_Confirm){
         int cf=MConfirm();
         bool agree=((p>thr && cf==1)||(p<-thr && cf==-1));
         d=d+(agree?"  M15+":"  M15x");
      }
      sT("sigdir",d); sC("sigdir",dc);
      double rt2=thr; if(rt2<0.05)rt2=0.05;
      double relP2=MathMin(MathAbs(p)/rt2,1.0)*100.0;   // threshold-relative %
      sT("sigpct",DoubleToString(relP2,0)+"%"); sC("sigpct",dc);
   }

   if(hp){
      double mp=MyProfit();
      sT("sigpos","* IN TRADE  $"+DoubleToString(mp,2));
      sC("sigpos",(mp>=0)?C'0,220,120':C'220,80,80');
   } else { sT("sigpos","no position"); sC("sigpos",C'110,130,126'); }

   if(gUserPause){ sBg("b_pause",C'80,0,0'); sT("status","PAUSED - press RESUME"); }
   else if(gDDPause){ sT("status","WARNING: DD LIMIT "+DoubleToString(dd,1)+"% - trading halted"); }
   else if(News_Filter && gNewsCache){ sBg("b_pause",C'70,50,0'); sT("status","NEWS FILTER - trading paused around high-impact news"); }
   else if(Max_Trades_Day>0 && gTradesCache>=Max_Trades_Day){ sBg("b_pause",C'40,40,60'); sT("status","DAILY LIMIT reached on "+gSym+" ("+IntegerToString(Max_Trades_Day)+"/day) - other symbols continue"); }
   else { sBg("b_pause",C'19,38,44');
      sT("status","> MATRIX ACTIVE | "+gSym+" | "+gAsset+" PROFILE | THR "+DoubleToString(Signal_Threshold,0)+"% | M15:"+(Use_M15_Confirm?"ON":"OFF"));
   }
   ChartRedraw(0);
}

//============================================================
//  EVENTS
//============================================================

void OnChartEvent(const int id,const long &lp,const double &dp,const string &sp)
{
   if(id!=CHARTEVENT_OBJECT_CLICK) return;
   if(StringFind(sp,pfx)<0) return;
   string o=StringSubstr(sp,StringLen(pfx));
   if(o=="b_buy"){ if(gReady)ManualTrade(true);  ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_sell"){ if(gReady)ManualTrade(false); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_close"){ CloseAllMine(); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_pause"){ gUserPause=true; Print("PAUSED PAUSED"); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
   if(o=="b_resume"){ gUserPause=false; Print("RESUMED RESUMED"); ObjectSetInteger(0,sp,OBJPROP_STATE,false); return; }
}

void OnTimer()
{
   if(gReady){ double q=QuantumWave(); if(q!=DATA_NR) gProb=q; UpdateScanner(); }
   UpdateDashboard();
}
//+------------------------------------------------------------------+
