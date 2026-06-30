import Image from "next/image";

const platforms = [
  {
    title: "MetaTrader 5",
    subtitle: "Expert Advisors",
    description: "Automated trading solutions for MT5 with advanced AI.",
    logo: "/platforms/mt5.png",
  },
  {
    title: "TradingView",
    subtitle: "Indicators & Strategies",
    description: "Powerful indicators and strategies for TradingView.",
    logo: "/platforms/tradingview.png",
  },
  {
    title: "cTrader",
    subtitle: "Professional cBots",
    description: "High-performance cBots for cTrader platform.",
    logo: "/platforms/ctrader.png",
  },
  {
    title: "NinjaTrader",
    subtitle: "Automated Strategies",
    description: "Robust automated strategies for NinjaTrader.",
    logo: "/platforms/ninjatrader.png",
  },
  {
    title: "Crypto Exchanges",
    subtitle: "Binance • Bybit • OKX",
    description: "AI trading bots for major crypto exchanges.",
    logo: "/platforms/binance.png",
  },
  {
    title: "Indian Markets",
    subtitle: "NSE • BSE • MCX",
    description: "Algo trading solutions for Indian stock & commodity markets.",
    logo: "/platforms/india.png",
  },
];

export default function Platforms() {
  return (
    <section className="bg-[#08111f] py-24">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-blue-500 uppercase tracking-[0.3em] font-semibold">
            Supported Platforms
          </p>

          <h2 className="text-5xl font-bold mt-5">
            One AI Platform.
            <br />
            Multiple Trading Ecosystems.
          </h2>

          <p className="text-gray-400 mt-5 text-lg">
            Build once. Deploy everywhere.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {platforms.map((platform) => (
            <div
              key={platform.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-8 transition-all duration-300 hover:border-blue-500 hover:-translate-y-2"
            >
              <div className="flex justify-center mb-6">
                <Image
                  src={platform.logo}
                  alt={platform.title}
                  width={72}
                  height={72}
                />
              </div>

              <h3 className="text-2xl font-bold text-center">
                {platform.title}
              </h3>

              <p className="text-blue-400 text-center mt-2 font-medium">
                {platform.subtitle}
              </p>

              <div className="w-12 h-px bg-blue-500 mx-auto my-5" />

              <p className="text-gray-400 text-center leading-7">
                {platform.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}