//+------------------------------------------------------------------+
//| AT24_VaultSelfTest.mq5 - one-shot SCRIPT that proves, on a real  |
//| MetaTrader 5, that the encrypted model of XXX US30 opens and     |
//| loads: licence check -> model key -> decrypt -> ONNX handle.     |
//| It places NO orders and changes nothing. Pass the test licence   |
//| key in the input; read the result in the Experts / Journal tab.  |
//+------------------------------------------------------------------+
#property script_show_inputs
#define AT24_PRODUCT_ID "XXXUS30"
#define AT24_WANT_MODEL_KEY
#include "AT24_License.mqh"
#include "AT24_ModelVault.mqh"

#resource "xxxus30_filter.bin" as uchar g_EncModel[]

input string InpKey = "";                 // AT24 licence key of the test licence
input string InpExpectedSha256Head = "";  // first hex chars of the plain model SHA-256 (optional)

string Hex(const uchar &d[], const int n)
  {
   string s = "";
   for(int i = 0; i < n && i < ArraySize(d); i++)
      s += StringFormat("%02x", d[i]);
   return s;
  }

void OnStart()
  {
   Print("=== AT24 vault self-test ===");
   // 1. the AES-free primitives: SHA-256 of "abc" must be ba7816bf...
   uchar abc[], dig[];
   StringToCharArray("abc", abc, 0, 3);
   if(!AT24V_Sha256(abc, dig)) { Print("FAIL sha256 call"); return; }
   Print("sha256(abc) = ", Hex(dig, 8), "  (expected ba7816bf8f01cfea)");

   // 2. licence check asks for the model key
   AT24LicenseResult r;
   bool ok = AT24_CheckLicense(InpKey, r);
   Print("licence valid=", ok, " reason=", r.reason, " detail=", r.detail, " expires=", r.expiresAt, " modelKey chars=", StringLen(r.modelKey));
   if(!ok || StringLen(r.modelKey) != 64) { Print("FAIL no model key"); return; }

   // 3. decrypt + integrity tag
   uchar plain[];
   if(!AT24Vault_Decrypt(g_EncModel, r.modelKey, plain)) { Print("FAIL decrypt (wrong key or damaged blob)"); return; }
   AT24V_Sha256(plain, dig);
   Print("decrypted ", ArraySize(plain), " bytes, sha256 head = ", Hex(dig, 8), InpExpectedSha256Head != "" ? ("  expected " + InpExpectedSha256Head) : "");

   // 4. wrong key must be refused
   string badKey = r.modelKey;
   badKey = "00" + StringSubstr(badKey, 2);
   uchar junk[];
   Print("wrong key refused: ", !AT24Vault_Decrypt(g_EncModel, badKey, junk));

   // 5. the model really loads
   long h = OnnxCreateFromBuffer(plain, ONNX_DEFAULT);
   Print("OnnxCreateFromBuffer handle valid: ", h != INVALID_HANDLE, " (error ", GetLastError(), ")");
   if(h != INVALID_HANDLE)
      OnnxRelease(h);
   AT24Vault_Wipe(plain);
   Print("=== self-test finished ===");
  }
