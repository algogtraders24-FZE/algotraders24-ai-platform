//+------------------------------------------------------------------+
//| AT24_GatedTrade.mqh - CTrade that opens NO new positions or      |
//| orders while the AT24 licence is refused (MetaTrader 5).         |
//|                                                                  |
//| For EAs that already use one global  CTrade trade;  object:      |
//|   #define AT24_PRODUCT_ID "YOUR-PRODUCT-ID"                      |
//|   #include <Trade\Trade.mqh>                                     |
//|   #include "AT24_GatedTrade.mqh"                                 |
//|   input string InpLicenseKey = "";                               |
//|   CAT24Trade trade;                      // instead of CTrade    |
//|   OnInit():  if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;|
//|   OnTimer(): AT24Gate_Timer(InpLicenseKey);                      |
//| Closing, modifying and deleting still work (open trades keep     |
//| being managed); only Buy / Sell / pending orders are blocked.    |
//| Buyers add https://www.algotraders24.ai under Tools > Options >  |
//| Expert Advisors > Allow WebRequest (once per terminal).          |
//+------------------------------------------------------------------+
#ifndef AT24_GATEDTRADE_MQH
#define AT24_GATEDTRADE_MQH

#include <Trade\Trade.mqh>
#include "AT24_LicenseGate.mqh"

class CAT24Trade : public CTrade
  {
public:
   bool              Refused(const string what)
     {
      if(AT24Gate_Allowed())
         return false;
      static datetime lastNote = 0;
      if(TimeLocal() - lastNote > 600)
        {
         lastNote = TimeLocal();
         Print("AT24 licence refused - no new trades (", what, " blocked): ", g_at24_message);
        }
      return true;
     }
   bool              Buy(const double volume, const string symbol = NULL, double price = 0.0, const double sl = 0.0, const double tp = 0.0, const string comment = "")
     {
      if(Refused("Buy"))
         return false;
      return CTrade::Buy(volume, symbol, price, sl, tp, comment);
     }
   bool              Sell(const double volume, const string symbol = NULL, double price = 0.0, const double sl = 0.0, const double tp = 0.0, const string comment = "")
     {
      if(Refused("Sell"))
         return false;
      return CTrade::Sell(volume, symbol, price, sl, tp, comment);
     }
   bool              PositionOpen(const string symbol, const ENUM_ORDER_TYPE order_type, const double volume, const double price, const double sl, const double tp, const string comment = "")
     {
      if(Refused("PositionOpen"))
         return false;
      return CTrade::PositionOpen(symbol, order_type, volume, price, sl, tp, comment);
     }
   bool              BuyStop(const double volume, const double price, const string symbol = NULL, const double sl = 0.0, const double tp = 0.0, const ENUM_ORDER_TYPE_TIME type_time = ORDER_TIME_GTC, const datetime expiration = 0, const string comment = "")
     {
      if(Refused("BuyStop"))
         return false;
      return CTrade::BuyStop(volume, price, symbol, sl, tp, type_time, expiration, comment);
     }
   bool              SellStop(const double volume, const double price, const string symbol = NULL, const double sl = 0.0, const double tp = 0.0, const ENUM_ORDER_TYPE_TIME type_time = ORDER_TIME_GTC, const datetime expiration = 0, const string comment = "")
     {
      if(Refused("SellStop"))
         return false;
      return CTrade::SellStop(volume, price, symbol, sl, tp, type_time, expiration, comment);
     }
   bool              BuyLimit(const double volume, const double price, const string symbol = NULL, const double sl = 0.0, const double tp = 0.0, const ENUM_ORDER_TYPE_TIME type_time = ORDER_TIME_GTC, const datetime expiration = 0, const string comment = "")
     {
      if(Refused("BuyLimit"))
         return false;
      return CTrade::BuyLimit(volume, price, symbol, sl, tp, type_time, expiration, comment);
     }
   bool              SellLimit(const double volume, const double price, const string symbol = NULL, const double sl = 0.0, const double tp = 0.0, const ENUM_ORDER_TYPE_TIME type_time = ORDER_TIME_GTC, const datetime expiration = 0, const string comment = "")
     {
      if(Refused("SellLimit"))
         return false;
      return CTrade::SellLimit(volume, price, symbol, sl, tp, type_time, expiration, comment);
     }
  };

#endif // AT24_GATEDTRADE_MQH
