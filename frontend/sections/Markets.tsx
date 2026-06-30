const MARKETS = [
  { name: "Forex", desc: "Major & minor currency pairs", change: "+3.25%", up: true, icon: "💱" },
  { name: "Gold & Metals", desc: "Gold, Silver & commodities", change: "+1.74%", up: true, icon: "🥇" },
  { name: "Crypto", desc: "Bitcoin, Ethereum & altcoins", change: "-0.84%", up: false, icon: "₿" },
  { name: "US Stocks", desc: "NASDAQ, Dow Jones & S&P 500", change: "+5.18%", up: true, icon: "📈" },
  { name: "Indian Markets", desc: "NIFTY, BANKNIFTY & NSE", change: "+0.58%", up: true, icon: "🇮🇳" },
  { name: "Indices", desc: "Global market indices", change: "+0.44%", up: true, icon: "🌐" },
];

export default function Markets() {
  return (
    <section className="bg-[#050816] text-white py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <span className="text-blue-500 font-semibold tracking-wide uppercase text-sm">
            Markets We Cover
          </span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4">
            Trade Every Major Market
          </h2>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto text-lg">
            Our AI trading systems work across all major global markets
            with intelligent automation and real-time analysis.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {MARKETS.map((market, index) => (
            <div
              key={index}
              className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6 hover:border-blue-500 transition duration-300"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-3xl">{market.icon}</span>
                <span className={`font-semibold ${market.up ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
                  {market.up ? "▲" : "▼"} {market.change}
                </span>
              </div>
              <h3 className="text-xl font-bold mb-1">{market.name}</h3>
              <p className="text-gray-400 text-sm">{market.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}