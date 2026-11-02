#property indicator_chart_window
#property indicator_plots 0
#define AT24_PRODUCT_ID "AT24-PIVOT-LEVELS-MAP"
#include "AT24_IndLicense.mqh"
bool g_done=false;
void Probe(const string where)
{
   AT24LicenseResult r;
   long login=(long)AccountInfoInteger(ACCOUNT_LOGIN);
   uint t0=GetTickCount();
   bool ok=AT24Ind_Check("AT24-THIS-IS-NOT-A-REAL-KEY-0000", r);
   PrintFormat("WEBTEST IND %s: login=%I64d ok=%d reason=%s detail=%s took=%ums",where,login,ok,r.reason,r.detail,GetTickCount()-t0);
}
int OnInit(){ Probe("OnInit"); return INIT_SUCCEEDED; }
int OnCalculate(const int rates_total,const int prev_calculated,const datetime &time[],const double &open[],const double &high[],const double &low[],const double &close[],const long &tick_volume[],const long &volume[],const int &spread[])
{ if(!g_done){ g_done=true; Probe("OnCalculate"); } return rates_total; }
