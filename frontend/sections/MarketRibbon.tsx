"use client";

const MARKET_DATA = [
  { symbol: "GOLD", price: "2,034.50", change: "+1.74%", up: true },
  { symbol: "BTC/USD", price: "67,420.00", change: "-0.84%", up: false },
  { symbol: "EUR/USD", price: "1.0892", change: "+0.32%", up: true },
  { symbol: "NIFTY 50", price: "22,415.20", change: "+0.58%", up: true },
  { symbol: "NASDAQ", price: "16,280.10", change: "+5.18%", up: true },
  { symbol: "SILVER", price: "24.85", change: "+0.91%", up: true },
  { symbol: "ETH/USD", price: "3,510.00", change: "-1.20%", up: false },
  { symbol: "GBP/USD", price: "1.2745", change: "+0.21%", up: true },
  { symbol: "DOW JONES", price: "38,990.40", change: "+0.44%", up: true },
  { symbol: "BANKNIFTY", price: "47,820.60", change: "+0.73%", up: true },
];

export default function MarketRibbon() {
  const items = [...MARKET_DATA, ...MARKET_DATA];

  return (
    <div className="w-full bg-[#0C1324] border-y border-[#1F2937] overflow-hidden py-3">
      <div className="flex animate-marquee whitespace-nowrap">
        {items.map((item, index) => (
          <div key={index} className="flex items-center mx-6 shrink-0">
            <span className="font-semibold text-white">{item.symbol}</span>
            <span className="ml-2 text-[#94A3B8]">{item.price}</span>
            <span
              className={`ml-2 font-medium ${
                item.up ? "text-[#22C55E]" : "text-[#EF4444]"
              }`}
            >
              {item.up ? "▲" : "▼"} {item.change}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}