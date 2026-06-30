const PRODUCTS = [
  {
    name: "AI Trend Master EA",
    platform: "MetaTrader 5",
    desc: "Advanced trend-following Expert Advisor with AI-powered entry and exit signals.",
    price: "$299",
    badge: "Best Seller",
    tag: "MT5",
  },
  {
    name: "Quantum Scalper Pro",
    platform: "MetaTrader 5",
    desc: "High-frequency scalping bot designed for fast markets and tight spreads.",
    price: "$249",
    badge: "New",
    tag: "MT5",
  },
  {
    name: "Smart Money Indicator",
    platform: "TradingView",
    desc: "Institutional order-flow indicator that tracks smart money movements.",
    price: "$149",
    badge: "Popular",
    tag: "TradingView",
  },
  {
    name: "Crypto Grid Bot",
    platform: "Binance / Bybit",
    desc: "Automated grid trading bot for crypto markets with risk controls.",
    price: "$199",
    badge: "",
    tag: "Crypto",
  },
  {
    name: "NIFTY Algo Pro",
    platform: "Indian Markets",
    desc: "Algorithmic strategy built for NIFTY & BANKNIFTY intraday trading.",
    price: "$179",
    badge: "India",
    tag: "NSE",
  },
  {
    name: "cTrader Swing cBot",
    platform: "cTrader",
    desc: "Swing trading cBot with multi-timeframe analysis and auto risk management.",
    price: "$229",
    badge: "",
    tag: "cTrader",
  },
];

export default function FeaturedProducts() {
  return (
    <section className="bg-[#0C1324] text-white py-24">
      <div className="max-w-7xl mx-auto px-6">
        {/* Heading */}
        <div className="text-center mb-16">
          <span className="text-blue-500 font-semibold tracking-wide uppercase text-sm">
            Featured Products
          </span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4">
            AI Trading Software That Works
          </h2>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto text-lg">
            Premium Expert Advisors, indicators and bots built with
            advanced AI for every major trading platform.
          </p>
        </div>

        {/* Product Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {PRODUCTS.map((product, index) => (
            <div
              key={index}
              className="rounded-2xl bg-[#111827] border border-[#1F2937] p-6 flex flex-col hover:border-blue-500 transition duration-300"
            >
              {/* Top: tag + badge */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-semibold bg-blue-600/20 text-blue-400 px-3 py-1 rounded-full">
                  {product.tag}
                </span>
                {product.badge && (
                  <span className="text-xs font-semibold bg-purple-600/20 text-purple-400 px-3 py-1 rounded-full">
                    {product.badge}
                  </span>
                )}
              </div>

              {/* Name + platform */}
              <h3 className="text-xl font-bold mb-1">{product.name}</h3>
              <p className="text-blue-400 text-sm mb-3">{product.platform}</p>

              {/* Description */}
              <p className="text-gray-400 text-sm flex-grow">{product.desc}</p>

              {/* Bottom: price + button */}
              <div className="flex items-center justify-between mt-6">
                <span className="text-2xl font-bold">{product.price}</span>
                <button className="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-xl font-semibold transition">
                  Buy Now
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* View all button */}
        <div className="text-center mt-12">
          <button className="border border-gray-600 hover:border-blue-500 px-8 py-4 rounded-xl font-semibold transition">
            View All Products
          </button>
        </div>
      </div>
    </section>
  );
}