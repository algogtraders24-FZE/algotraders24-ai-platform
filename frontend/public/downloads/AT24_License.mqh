//+------------------------------------------------------------------+
//| AT24_License.mqh - one-call licence check for products sold on   |
//| the AT24 Marketplace (MetaTrader 4 and 5).                       |
//|                                                                  |
//| The buyer pastes ONE key (shown on their AT24 purchase page) into|
//| your EA's input. The EA sends only that key plus the trading     |
//| account number/server to AT24 and gets a yes/no back.            |
//|                                                                  |
//| SETUP FOR YOUR BUYERS (once per terminal):                       |
//|   Tools > Options > Expert Advisors > "Allow WebRequest for      |
//|   listed URL" > add  https://www.algotraders24.ai                |
//|                                                                  |
//| USAGE in your EA:                                                |
//|   #include "AT24_License.mqh"                                    |
//|   input string InpLicenseKey = "";                               |
//|   int OnInit()                                                   |
//|     {                                                            |
//|      AT24LicenseResult lic;                                      |
//|      if(!AT24_CheckLicense(InpLicenseKey, lic))                  |
//|        {                                                         |
//|         Print("AT24 licence refused: ", lic.reason, " - ", lic.detail);|
//|         return INIT_FAILED;                                      |
//|        }                                                         |
//|      return INIT_SUCCEEDED;   // lic.buyerId, lic.expiresAt      |
//|     }                                                            |
//|   (Call it again from OnTimer every few hours if you want the    |
//|   EA to stop when a licence is revoked or expires.)              |
//|                                                                  |
//| bindAccount=true (default): the licence is tied to the buyer's   |
//| trading account (first account to run it takes the slot; the     |
//| same account always works). false: any account may run it.       |
//| If AT24 cannot be reached the function returns false - decide in |
//| your EA whether to allow a grace period.                         |
//+------------------------------------------------------------------+
#ifndef AT24_LICENSE_MQH
#define AT24_LICENSE_MQH

#define AT24_LICENSE_URL "https://www.algotraders24.ai/api/license/check"

struct AT24LicenseResult
  {
   bool   valid;
   string reason;     // e.g. INVALID_KEY, LICENSE_REVOKED, LICENSE_EXPIRED, ACCOUNT_LIMIT_REACHED, WEBREQUEST_FAILED
   string detail;
   string buyerId;
   string expiresAt;  // "" = never
  };

//--- value of a simple JSON string field: "field":"value"  ("" if absent)
string AT24L_Str(const string json, const string field)
  {
   string tag = "\"" + field + "\":\"";
   int p = StringFind(json, tag);
   if(p < 0)
      return "";
   p += StringLen(tag);
   int q = StringFind(json, "\"", p);
   if(q < 0)
      return "";
   return StringSubstr(json, p, q - p);
  }

bool AT24_CheckLicense(const string key, AT24LicenseResult &res, const bool bindAccount = true, const int timeoutMs = 8000)
  {
   res.valid = false;
   res.reason = "";
   res.detail = "";
   res.buyerId = "";
   res.expiresAt = "";
   if(StringLen(key) < 20)
     {
      res.reason = "INVALID_KEY";
      res.detail = "No licence key entered in the EA inputs.";
      return false;
     }

   string body = "{\"key\":\"" + key + "\"";
   if(bindAccount)
     {
#ifdef __MQL5__
      body += ",\"account\":\"" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)) + "\"";
      body += ",\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\"";
#else
      body += ",\"account\":\"" + IntegerToString(AccountNumber()) + "\"";
      body += ",\"server\":\"" + AccountServer() + "\"";
#endif
     }
   body += "}";

   char data[], out[];
   StringToCharArray(body, data, 0, StringLen(body), CP_UTF8);
   string headers = "Content-Type: application/json\r\n", outHeaders;
   ResetLastError();
   int code = WebRequest("POST", AT24_LICENSE_URL, headers, timeoutMs, data, out, outHeaders);
   if(code == -1)
     {
      int err = GetLastError();
      res.reason = "WEBREQUEST_FAILED";
      res.detail = "WebRequest error " + IntegerToString(err) + (err == 4060 ? " - add https://www.algotraders24.ai under Tools > Options > Expert Advisors > Allow WebRequest" : "");
      return false;
     }
   string text = CharArrayToString(out, 0, ArraySize(out), CP_UTF8);
   if(code != 200)
     {
      res.reason = "SERVER_" + IntegerToString(code);
      res.detail = text;
      return false;
     }
   res.valid     = (StringFind(text, "\"valid\":true") >= 0);
   res.reason    = AT24L_Str(text, "reason");
   res.detail    = AT24L_Str(text, "detail");
   res.buyerId   = AT24L_Str(text, "buyerId");
   res.expiresAt = AT24L_Str(text, "expiresAt");
   return res.valid;
  }

#endif // AT24_LICENSE_MQH
