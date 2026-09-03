//+------------------------------------------------------------------+
//|  ALGOTRADERS24 AI - License Key Generator (SELLER ONLY)          |
//|  Run this script in YOUR MT5. Enter client account + expiry.    |
//|  It prints the KEY to give the client. NEVER share this file.   |
//+------------------------------------------------------------------+
#property script_show_inputs
#property copyright "ALGOTRADERS24 AI"

// MUST match the LIC_SECRET inside license_module.mqh exactly.
#define LIC_SECRET  "AT24-CHANGE-ME-9f3K7pQ2xL8mZ1vR-keep-private"

input long   Client_Account = 12345678;    // Client's MT5 account number
input int    Expiry_Year     = 2027;       // License valid until... year
input int    Expiry_Month    = 12;         // month
input int    Expiry_Day      = 31;         // day

uint Lic_Hash(string s){
   uint h=2166136261;
   for(int i=0;i<StringLen(s);i++){ h^=(uint)StringGetCharacter(s,i); h*=16777619; }
   return h;
}
string Lic_Block(uint v){
   string chars="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; string r="";
   for(int i=0;i<4;i++){ r=StringSubstr(chars,(int)(v%36),1)+r; v/=36; }
   return r;
}
string Lic_ExpectedKey(long account,long expiryYMD){
   string base=LIC_SECRET+"|"+IntegerToString(account)+"|"+IntegerToString(expiryYMD);
   uint h1=Lic_Hash(base+"|1"),h2=Lic_Hash(base+"|2"),h3=Lic_Hash(base+"|3"),h4=Lic_Hash(base+"|4");
   return Lic_Block(h1)+"-"+Lic_Block(h2)+"-"+Lic_Block(h3)+"-"+Lic_Block(h4);
}

void OnStart()
{
   long ymd=(long)Expiry_Year*10000+(long)Expiry_Month*100+(long)Expiry_Day;
   string key=Lic_ExpectedKey(Client_Account,ymd);
   Print("=================================================");
   Print(" ALGOTRADERS24 AI - LICENSE GENERATED");
   Print(" Client Account : ",Client_Account);
   Print(" Valid Until    : ",Expiry_Year,".",Expiry_Month,".",Expiry_Day," (",ymd,")");
   Print(" LICENSE KEY    : ",key);
   Print("=================================================");
   Print(" Give the client BOTH:");
   Print("   License_Key    = ",key);
   Print("   License_Expiry = ",ymd);
   Comment("LICENSE KEY: ",key,"\nEXPIRY: ",ymd,"\n(see Experts log for details)");
}
