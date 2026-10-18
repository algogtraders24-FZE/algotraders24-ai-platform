//+------------------------------------------------------------------+
//| AT24_LicenseGate.mqh - drop-in licence gate for AT24 Marketplace |
//| products (MetaTrader 4 and 5). Wraps AT24_License.mqh.           |
//|                                                                  |
//| What it does for your EA:                                        |
//|  * at start: checks the buyer's key (one key = one trading       |
//|    account, and only for THIS product); refuses to start if not  |
//|  * every 4 hours: checks again. A key that was revoked, expired, |
//|    moved to another account or belongs to another product STOPS  |
//|    new trades at once (open trades are still managed).           |
//|  * a short internet problem never stops a running EA: it keeps   |
//|    trading for up to 72 hours since the last successful check.   |
//|  * the Strategy Tester needs no key (WebRequest is not available |
//|    there), so backtests of the EA still work.                    |
//|                                                                  |
//| HOW TO USE (3 lines in your EA):                                 |
//|   #define AT24_PRODUCT_ID "YOUR-PRODUCT-ID"                      |
//|   #include "AT24_LicenseGate.mqh"                                |
//|   input string InpLicenseKey = "";                               |
//|   OnInit():   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;|
//|   OnTimer():  AT24Gate_Timer(InpLicenseKey);   (EventSetTimer(1)) |
//|   OnTick():   if(!AT24Gate_Allowed()) { ...no NEW trades... }    |
//| Buyers add https://www.algotraders24.ai under Tools > Options >  |
//| Expert Advisors > Allow WebRequest (once per terminal).          |
//+------------------------------------------------------------------+
#ifndef AT24_LICENSEGATE_MQH
#define AT24_LICENSEGATE_MQH

#include "AT24_License.mqh"

#ifndef AT24GATE_RECHECK_SECONDS
#define AT24GATE_RECHECK_SECONDS  14400    // 4 hours
#endif
#ifndef AT24GATE_GRACE_SECONDS
#define AT24GATE_GRACE_SECONDS    259200   // 72 hours without a successful check
#endif

bool     g_at24_allowed   = true;
datetime g_at24_lastTry   = 0;
datetime g_at24_lastGood  = 0;
string   g_at24_message   = "";

bool AT24Gate_IsTester()
  {
#ifdef __MQL5__
   return (MQLInfoInteger(MQL_TESTER) != 0 || MQLInfoInteger(MQL_OPTIMIZATION) != 0);
#else
   return (IsTesting() || IsOptimization());
#endif
  }

//--- reasons that mean "this key may NOT run this EA" (as opposed to a network problem)
bool AT24Gate_IsRefusal(const string reason)
  {
   return (reason == "INVALID_KEY" || reason == "LICENSE_REVOKED" || reason == "LICENSE_SUSPENDED" || reason == "LICENSE_EXPIRED" ||
           reason == "LICENSE_NOT_USABLE" || reason == "RELEASE_REVOKED" || reason == "ACCOUNT_LIMIT_REACHED" || reason == "WRONG_PRODUCT" ||
           reason == "ACCOUNT_REQUIRED");
  }

string AT24Gate_Explain(const AT24LicenseResult &r)
  {
   if(r.reason == "ACCOUNT_LIMIT_REACHED")
      return "This key is already used on another trading account. Change it on your AT24 purchase page (Dashboard > Purchases > Change trading account).";
   if(r.reason == "WRONG_PRODUCT")
      return "This key belongs to a different product.";
   if(r.reason == "INVALID_KEY")
      return "Licence key missing or wrong. Paste the key from your AT24 purchase page into the EA input InpLicenseKey.";
   if(r.reason == "WEBREQUEST_FAILED")
      return "Cannot reach AT24. " + r.detail;
   return r.reason + (r.detail != "" ? " - " + r.detail : "");
  }

//--- OnInit: returns false if the EA must not start
bool AT24Gate_Init(const string key)
  {
   g_at24_allowed = true;
   if(AT24Gate_IsTester())
      return true;
   AT24LicenseResult r;
   g_at24_lastTry = TimeLocal();
   if(AT24_CheckLicense(key, r))
     {
      g_at24_lastGood = TimeLocal();
      g_at24_message = "";
      Print("AT24 licence OK");
      return true;
     }
   g_at24_allowed = false;
   g_at24_message = AT24Gate_Explain(r);
   Print("AT24 licence refused: ", g_at24_message);
   Alert("AT24 licence: ", g_at24_message);
   Comment("AT24 licence: ", g_at24_message);
   return false;
  }

//--- OnTimer: re-checks every 4 hours
void AT24Gate_Timer(const string key)
  {
   if(AT24Gate_IsTester())
      return;
   datetime now = TimeLocal();
   if(now - g_at24_lastTry < AT24GATE_RECHECK_SECONDS)
      return;
   g_at24_lastTry = now;
   AT24LicenseResult r;
   if(AT24_CheckLicense(key, r))
     {
      g_at24_allowed = true;
      g_at24_lastGood = now;
      if(g_at24_message != "")
         Comment("");
      g_at24_message = "";
      return;
     }
   if(AT24Gate_IsRefusal(r.reason))
     {
      g_at24_allowed = false;
      g_at24_message = AT24Gate_Explain(r);
      Print("AT24 licence refused - no new trades: ", g_at24_message);
      Comment("AT24 licence: ", g_at24_message);
      return;
     }
   // network problem: keep running, but not forever
   if(g_at24_lastGood > 0 && now - g_at24_lastGood > AT24GATE_GRACE_SECONDS)
     {
      g_at24_allowed = false;
      g_at24_message = "Cannot reach AT24 for more than 72 hours. " + r.detail;
      Print("AT24 licence: ", g_at24_message);
      Comment("AT24 licence: ", g_at24_message);
     }
  }

//--- OnTick: may this EA open NEW trades right now?
bool AT24Gate_Allowed()
  {
   return g_at24_allowed;
  }

#endif // AT24_LICENSEGATE_MQH
