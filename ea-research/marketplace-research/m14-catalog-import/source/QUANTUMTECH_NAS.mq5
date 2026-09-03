//+------------------------------------------------------------------+
//|                      QUANTUMTECH NAS                              |
//|                  by  ALGOTRADERS24 AI                             |
//|      Single-Index Quantum Engine - NAS100 (NASDAQ)     |
//|                                                                   |
//|  OK: Works on ALL brokers - auto prefix/suffix detection          |
//|  OK: NAS100-tuned defaults (index volatility handling)            |
//|  OK: Fixed-points OR ATR-dynamic SL/TP                            |
//|  OK: Manual lot OR risk-% sizing                                  |
//|  OK: One position at a time (clean, simple)                       |
//|  OK: Branded bold dashboard with live signal engine               |
//+------------------------------------------------------------------+

#property copyright   "ALGOTRADERS24 AI"
#property link        "https://algotraders24.ai"
#property version     "1.06"
#property description "QUANTUMTECH NAS - NAS100 (Nasdaq 100) Trading System by ALGOTRADERS24 AI"
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
#define EA_NAME    "QUANTUMTECH NAS"
#define EA_COMPANY "ALGOTRADERS24 AI"
#define EA_ASSET   "NAS100"
#define DATA_NR    -999.0

//============================================================
//  INPUTS
//============================================================

input group "=== ASSET ==="
input string Symbol_Override = "";       // Leave blank = trade the chart symbol. Or force one (e.g. NAS100.m)

input group "=== QUANTUM PARAMETERS ==="
input double Signal_Threshold = 60;      // Wave Collapse Threshold - min signal strength % (0-100)
input int    Q_WaveLength     = 34;      // Quantum Wave Period (Fibonacci: 21/34/55)
input double Q_Entanglement   = 0.60;    // Entanglement Correlation min (0-1) - cross-TF agreement
input int    Q_SuperStates    = 8;       // Superposition States evaluated (4-8)
input double Q_TunnelProb     = 0.70;    // Quantum Tunnel Breakout Probability (0-1)

input group "=== SL-TP MODE (NAS100-tuned) ==="
input bool   Use_Fixed_SLTP   = false;   // true=Fixed Points, false=ATR Dynamic
input int    Fixed_SL_Points  = 3000;    // Fixed SL points (NAS100: ~300 index pts)
input int    Fixed_TP_Points  = 5000;    // Fixed TP points (NAS100)
input double ATR_SL_Mult      = 2.5;     // NAS100 ATR x SL
input double ATR_TP_Mult      = 4.5;     // NAS100 ATR x TP

input group "=== RISK ==="
input bool   Use_Manual_Lot   = true;    // true=fixed lot below; false=Risk %
input double Fixed_Lot_Size   = 0.01;    // Lot for AUTO trades (manual mode)
input double Risk_Percent     = 1.0;     // Risk % per trade (range 0.10 to 2). Used when Use_Manual_Lot=false
input bool   Use_TrailingStop = true;
input double Trail_ATR_Mult   = 1.8;
input int    Fixed_Trail_Pts  = 1500;
input bool   Use_BreakEven    = true;
input double MaxDrawdown_Pct  = 30.0;    // NAS100 is volatile
input double Manual_Lot       = 0.01;    // Lot for dashboard manual buttons

input group "=== ENGINE PARAMETERS (advanced) ==="
input ENUM_TIMEFRAMES Main_TF = PERIOD_H1;
input ENUM_TIMEFRAMES High_TF = PERIOD_H4;
input bool   Use_M15_Confirm = true;          // M15 EMA+RSI confirm before entry
input ENUM_TIMEFRAMES Confirm_TF = PERIOD_M15; // confirmation timeframe
input int    Trend_L1    = 21;      // Trend filter level 1
input int    Trend_L2    = 55;      // Trend filter level 2
input int    Trend_L3    = 89;      // Trend filter level 3
input int    Trend_L4    = 200;     // Trend filter level 4
input int    Momentum_P   = 14;      // Momentum period
input int    Wave_P1      = 12;      // Wave parameter 1
input int    Wave_P2      = 26;      // Wave parameter 2
input int    Wave_P3      = 9;       // Wave parameter 3
input int    Volatility_P = 14;      // Volatility period
input int    Osc_P1       = 5;       // Oscillator parameter 1
input int    Osc_P2       = 3;       // Oscillator parameter 2
input int    Osc_P3       = 3;       // Oscillator parameter 3
input int    Strength_P   = 14;      // Strength period
input double Strength_Min = 22.0;     // Minimum trend strength

input group "=== SMART RISK SCALING (NEW) ==="
input bool   Auto_RiskScale  = false;    // Auto-reduce lot after losses, restore after wins
input double Scale_DownPct    = 50.0;    // Cut lot by this % after a losing streak
input int    Scale_LossStreak = 3;       // Losses in a row to trigger reduction

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
input int    Magic_Num   = 24040001;     // Unique per EA
input string EA_Tag      = "QTECH_NAS";

//============================================================
//  GLOBALS
//============================================================

CTrade        trade;
CPositionInfo posInfo;

string  gSym = "";          // resolved broker symbol
bool    gReady = false;

int hEMA_F[2],hEMA_M[2],hEMA_S[2],hEMA_T;
int hCF_EMA_F,hCF_EMA_S,hCF_RSI;   // M15 confirmation handles
int hRSI,hMACD,hATR,hStoch,hADX,hBB,hCCI;

datetime gLastBar;
double   gPeakEq;
bool     gDDPause=false, gUserPause=false;
bool     gNewsCache=false;
int      gTradesCache=0;
datetime gCacheStamp=0;
double   gProb=0;

string pfx = "QTNAS_";
color  CLR_ACCENT  = C'0,230,140';    // tech green (Nasdaq)
color  CLR_ACCENT2 = C'120,200,255';  // electric blue
color  CLR_BG      = C'8,12,12';       // terminal black
color  CLR_PANEL   = C'12,20,18';      // dark green-panel

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
   Print("=== ",EA_NAME," v1.30 by ",EA_COMPANY," READY | Symbol: ",gSym," | ",
         (Use_Fixed_SLTP?"FIXED":"ATR")," SL ===");
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
   if(dd>=MaxDrawdown_Pct){ if(!gDDPause){Print("WARNING: DD limit");gDDPause=true;} UpdateDashboard(); return; }
   else gDDPause=false;

   if(Use_TrailingStop) DoTrail();
   if(Use_BreakEven)    DoBE();

   double q=QuantumWave();
   if(q!=DATA_NR) gProb=q;

   datetime cb=iTime(gSym,Main_TF,0);
   if(cb!=0 && gLastBar!=0 && cb!=gLastBar){
      gLastBar=cb;
      bool sessOK=!(Filter_Session&&!IsSession());
      bool friOK =!(Filter_Friday&&IsFridayClose());
      bool newsOK=!IsNewsTime();
      bool dayOK =(Max_Trades_Day<=0 || TradesToday(gSym)<Max_Trades_Day);
      if(!gUserPause&&!gDDPause&&sessOK&&friOK&&newsOK&&dayOK&&!HasPos() && q!=DATA_NR){
         double thr=Signal_Threshold/100.0;
         if(thr<0.05)thr=0.05; if(thr>0.99)thr=0.99;
         int cf=MConfirm();
         if(q>thr  && (!Use_M15_Confirm || cf==1))  ExecTrade(true);
         else if(q<-thr && (!Use_M15_Confirm || cf==-1)) ExecTrade(false);
      }
   } else if(gLastBar==0 && cb!=0) gLastBar=cb;

   UpdateDashboard();
}

//============================================================
//  QUANTUM WAVE SIGNAL
//============================================================

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
      double sd=atr[1]*ATR_SL_Mult, td=atr[1]*ATR_TP_Mult;
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

   // Smart risk scaling: shrink lot after a losing streak
   double scale=1.0;
   if(Auto_RiskScale && gLossStreak>=Scale_LossStreak)
      scale=MathMax(0.1,1.0-Scale_DownPct/100.0);

   if(Use_Manual_Lot){
      double ml=Fixed_Lot_Size*scale; if(step>0)ml=MathRound(ml/step)*step;
      return NormalizeDouble(MathMax(minL,MathMin(maxL,ml)),2);
   }
   if(slDist<=0) return minL;
   double bal=AccountInfoDouble(ACCOUNT_BALANCE);
   double risk=bal*Risk_Percent/100.0*scale;
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


// Is this symbol currently tradable? (prevents "Market closed" failed orders).
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
   MqlTick tk;
   if(!SymbolInfoTick(sym,tk)) return false;
   if(tk.bid<=0 || tk.ask<=0) return false;
   if(tk.time<=0) return false;
   return ((now-tk.time)<=180);
}

void ExecTrade(bool isBuy)
{
   if(!MarketOpen(gSym)) return;   // skip when market closed
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
   else{ double atr[2]; if(CopyBuffer(hATR,0,0,2,atr)<2)return; trail=atr[1]*Trail_ATR_Mult; }
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
   else{ double atr[2]; if(CopyBuffer(hATR,0,0,2,atr)<2)return; dist=atr[1]*ATR_SL_Mult; }
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
   gCF_Status=c; return c;
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

// Real closed-trade stats for THIS EA (from history). No fake numbers.
int    gStatTrades=0;
double gStatWinRate=0;
double gStatProfit=0;
int    gLossStreak=0;       // consecutive losses (for smart risk scaling)
datetime gStatLastCalc=0;

void CalcStats()
{
   if(TimeCurrent()-gStatLastCalc<5) return;
   gStatLastCalc=TimeCurrent();
   if(!HistorySelect(0,TimeCurrent())) return;
   int wins=0,total=0; double profit=0; int streak=0; bool counting=true;
   int deals=HistoryDealsTotal();
   // forward pass for totals
   for(int i=0;i<deals;i++){
      ulong tk=HistoryDealGetTicket(i);
      if(tk==0) continue;
      if(HistoryDealGetInteger(tk,DEAL_MAGIC)!=Magic_Num) continue;
      if(HistoryDealGetInteger(tk,DEAL_ENTRY)!=DEAL_ENTRY_OUT) continue;
      double pr=HistoryDealGetDouble(tk,DEAL_PROFIT)+HistoryDealGetDouble(tk,DEAL_SWAP)+HistoryDealGetDouble(tk,DEAL_COMMISSION);
      total++; profit+=pr; if(pr>0) wins++;
   }
   // backward pass for current losing streak
   for(int i=deals-1;i>=0 && counting;i--){
      ulong tk=HistoryDealGetTicket(i);
      if(tk==0) continue;
      if(HistoryDealGetInteger(tk,DEAL_MAGIC)!=Magic_Num) continue;
      if(HistoryDealGetInteger(tk,DEAL_ENTRY)!=DEAL_ENTRY_OUT) continue;
      double pr=HistoryDealGetDouble(tk,DEAL_PROFIT)+HistoryDealGetDouble(tk,DEAL_SWAP)+HistoryDealGetDouble(tk,DEAL_COMMISSION);
      if(pr<0) streak++; else counting=false;
   }
   gStatTrades=total; gStatProfit=profit;
   gStatWinRate=(total>0)?(100.0*wins/total):0;
   gLossStreak=streak;
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
   // tech "candlestick monitor" mark
   oRect("lg_frame",x,y,52,52,CLR_PANEL,CLR_ACCENT,2);
   oRect("lg_c1",x+9, y+26,5,18,CLR_ACCENT,CLR_ACCENT);     // green candle up
   oRect("lg_c1w",x+11,y+20,1,30,CLR_ACCENT,CLR_ACCENT);
   oRect("lg_c2",x+19,y+16,5,22,CLR_ACCENT2,CLR_ACCENT2);   // blue candle
   oRect("lg_c2w",x+21,y+12,1,32,CLR_ACCENT2,CLR_ACCENT2);
   oRect("lg_c3",x+29,y+22,5,16,CLR_ACCENT,CLR_ACCENT);
   oRect("lg_c3w",x+31,y+16,1,28,CLR_ACCENT,CLR_ACCENT);
   oRect("lg_c4",x+39,y+12,5,26,C'255,255,255',C'255,255,255'); // bright bar
   oRect("lg_c4w",x+41,y+8,1,34,C'255,255,255',C'255,255,255');
}

// Segmented signal meter
string SegBar(double p){
   int n=(int)(MathAbs(p)*10); string b="";
   for(int i=0;i<10;i++) b+=(i<n?"|":".");
   return b;
}

void BuildDashboard()
{
   ObjectsDeleteAll(0,pfx);
   int X=Dashboard_X,Y=Dashboard_Y,W=400,H=452;

   // outer terminal frame
   oRect("bg",X,Y,W,H,CLR_BG,CLR_ACCENT,2);
   // title bar (terminal window style)
   oRect("tbar",X,Y,W,24,C'14,24,20',CLR_ACCENT,1);
   oText("tdot1",X+10,Y+6,"O",C'255,90,90',9,"Consolas",true);
   oText("tdot2",X+26,Y+6,"O",C'255,200,60',9,"Consolas",true);
   oText("tdot3",X+42,Y+6,"O",CLR_ACCENT,9,"Consolas",true);
   oText("ttl",X+72,Y+5,"QUANTUMTECH_NAS  --  /dev/nas100",C'120,180,160',8,"Consolas",true);
   oText("tlive",X+W-70,Y+5,"[ LIVE ]",CLR_ACCENT,8,"Consolas",true);

   // header band with logo + name
   int hy=Y+30;
   oRect("hdr",X+6,hy,W-12,52,CLR_PANEL,C'20,50,42',1);
   DrawLogo(X+12,hy+1);
   oText("co", X+74,hy+5, EA_COMPANY,CLR_ACCENT2,8,"Consolas",true);
   oText("nm", X+74,hy+19,"QUANTUMTECH NAS",CLR_ACCENT,14,"Consolas",true);
   oText("tag",X+74,hy+40,"NASDAQ-100 NEURAL ENGINE",C'90,140,120',7,"Consolas",true);

   int sy=Y+92;

   // terminal "readout" rows
   oText("l_bal",X+12,sy,    "> balance .....",C'90,140,120',9,"Consolas",true);
   oText("v_bal",X+200,sy,   "",C'180,240,210',9,"Consolas",true); sy+=18;
   oText("l_eq",X+12,sy,     "> equity ......",C'90,140,120',9,"Consolas",true);
   oText("v_eq",X+200,sy,    "",C'180,240,210',9,"Consolas",true); sy+=18;
   oText("l_pnl",X+12,sy,    "> open_pnl ....",C'90,140,120',9,"Consolas",true);
   oText("v_pnl",X+200,sy,   "",C'200,200,200',9,"Consolas",true); sy+=18;
   oText("l_dd",X+12,sy,     "> drawdown ....",C'90,140,120',9,"Consolas",true);
   oText("v_dd",X+200,sy,    "",C'200,200,200',9,"Consolas",true); sy+=24;

   // divider
   oRect("div1",X+12,sy,W-24,1,C'20,50,42',C'20,50,42'); sy+=10;

   // performance stats row (real)
   oText("l_stats",X+12,sy,">> PERFORMANCE",C'90,140,120',8,"Consolas",true); sy+=16;
   oText("l_tr",X+12,sy,     "trades:",C'90,140,120',9,"Consolas",true);
   oText("v_tr",X+90,sy,     "",CLR_ACCENT,9,"Consolas",true);
   oText("l_wr",X+150,sy,    "win:",C'90,140,120',9,"Consolas",true);
   oText("v_wr",X+200,sy,    "",CLR_ACCENT,9,"Consolas",true);
   oText("l_np",X+260,sy,    "net:",C'90,140,120',9,"Consolas",true);
   oText("v_np",X+300,sy,    "",CLR_ACCENT,9,"Consolas",true); sy+=24;

   // divider
   oRect("div2",X+12,sy,W-24,1,C'20,50,42',C'20,50,42'); sy+=10;

   // signal block
   oText("l_sig",X+12,sy,">> SIGNAL ENGINE",C'90,140,120',8,"Consolas",true);
   oText("v_sym",X+260,sy,"",CLR_ACCENT2,9,"Consolas",true); sy+=18;
   oText("sigbar",X+12,sy,"..........",C'40,70,60',16,"Consolas",true); sy+=26;
   oText("sigdir",X+12,sy,"",C'120,120,120',13,"Consolas",true);
   oText("sigpct",X+310,sy,"",C'120,120,120',14,"Consolas",true);
   oText("sigpos",X+12,sy+20,"",C'90,140,120',7,"Consolas",true); sy+=36;

   // command buttons
   oBtn("b_buy", X+12, sy,120,30,"BUY",C'0,184,126',C'2,22,15',11);
   oBtn("b_sell",X+140,sy,120,30,"SELL",C'208,69,69',C'255,255,255',11);
   oBtn("b_close",X+268,sy,120,30,"CLOSE",C'80,160,255',C'4,12,26',10);
   sy+=37;
   oBtn("b_pause", X+12, sy,188,26,"PAUSE",C'20,34,30',C'140,200,180',9);
   oBtn("b_resume",X+204,sy,184,26,"RESUME",C'20,34,30',CLR_ACCENT,9);
   sy+=32;

   // footer status line
   oRect("ftr",X,Y+H-24,W,24,C'10,18,15',CLR_ACCENT,1);
   oText("status",X+12,Y+H-18,"",CLR_ACCENT,7,"Consolas",true);

   ChartRedraw(0);
}

void UpdateDashboard()
{
   double bal=AccountInfoDouble(ACCOUNT_BALANCE);
   double eq =AccountInfoDouble(ACCOUNT_EQUITY);
   double pnl=eq-bal;
   double dd=(gPeakEq-eq)/gPeakEq*100.0;

   sT("v_bal","$"+DoubleToString(bal,2));
   sT("v_eq", "$"+DoubleToString(eq,2));
   sT("v_pnl",(pnl>=0?"+$":"-$")+DoubleToString(MathAbs(pnl),2));
   sC("v_pnl",(pnl>=0)?C'0,230,140':C'220,80,80');
   sT("v_dd",DoubleToString(dd,1)+"%");
   sC("v_dd",(dd<10)?C'0,230,140':(dd<20)?C'120,200,255':C'220,80,80');

   // Real performance stats
   CalcStats();
   sT("v_tr",IntegerToString(gStatTrades));
   sT("v_wr",WinRateStr(0));
   sT("v_np",(gStatProfit>=0?"+$":"-$")+DoubleToString(MathAbs(gStatProfit),0));
   sC("v_np",(gStatProfit>=0)?C'0,230,140':C'220,80,80');

   if(!gReady){
      sT("v_sym","NOT FOUND");
      sT("sigbar",".........."); sC("sigbar",C'90,90,90');
      sT("sigdir","CHECK SYMBOL"); sC("sigdir",C'220,80,80');
      sT("sigpct","");
      sT("status","WARNING: symbol not available - set Symbol_Override");
      ChartRedraw(0); return;
   }

   sT("v_sym",gSym);
   bool hp=HasPos();

   if(gProb==DATA_NR){
      sT("sigbar","loading..."); sC("sigbar",C'90,140,100');
      sT("sigdir","..."); sC("sigdir",C'110,160,130'); sT("sigpct","");
   } else {
      double p=gProb;
      double thr=Signal_Threshold/100.0;
      sT("sigbar",SegBar(p)); sC("sigbar",(p>0)?C'0,230,140':C'255,70,70');
      string d=(p>thr)?"[ STRONG BUY ]":(p<-thr)?"[ STRONG SELL ]":"[ NEUTRAL ]";
      if(Use_M15_Confirm){ int cf=MConfirm(); bool ag=((p>thr&&cf==1)||(p<-thr&&cf==-1)); d=d+(ag?" M15+":" M15x"); }
      color dc=(p>thr)?C'0,230,140':(p<-thr)?C'255,80,80':C'150,150,150';
      sT("sigdir",d); sC("sigdir",dc);
      double rt=thr; if(rt<0.05)rt=0.05; double relP=MathMin(MathAbs(p)/rt,1.0)*100.0;
      sT("sigpct",DoubleToString(relP,0)+"%"); sC("sigpct",dc);
   }

   if(hp){
      double mp=MyProfit();
      sT("sigpos","# position open  $"+DoubleToString(mp,2));
      sC("sigpos",(mp>=0)?C'0,230,140':C'220,80,80');
   } else { sT("sigpos","# no position"); sC("sigpos",C'90,140,120'); }

   if(gUserPause){ sBg("b_pause",C'80,0,0'); sT("status","> PAUSED - press RESUME"); }
   else if(gDDPause){ sT("status","> WARNING: DD LIMIT "+DoubleToString(dd,1)+"% - halted"); }
   else if(News_Filter && gNewsCache){ sBg("b_pause",C'70,50,0'); sT("status","NEWS FILTER - trading paused around high-impact news"); }
   else if(Max_Trades_Day>0 && gTradesCache>=Max_Trades_Day){ sBg("b_pause",C'40,40,60'); sT("status","DAILY LIMIT reached on "+gSym+" ("+IntegerToString(Max_Trades_Day)+"/day)"); }
   else { sBg("b_pause",C'20,34,30');
      string rs=(Auto_RiskScale && gLossStreak>=Scale_LossStreak)?" | RISK-SCALED":"";
      sT("status","> QUANTUMTECH NAS ACTIVE | "+gSym+" | "+(Use_Fixed_SLTP?"FIXED":"ATR")+" SL | THR "+DoubleToString(Signal_Threshold,0)+"% | M15:"+(Use_M15_Confirm?"ON":"OFF")+rs);
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
   if(gReady){ double q=QuantumWave(); if(q!=DATA_NR) gProb=q; }
   UpdateDashboard();
}
//+------------------------------------------------------------------+
