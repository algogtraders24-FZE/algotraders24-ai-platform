const FEATURES = [
  {
    icon: "🧠",
    title: "Neural Network Engine",
    desc: "Deep learning models trained on millions of market data points to predict price movements with precision.",
  },
  {
    icon: "⚡",
    title: "Real-Time Analysis",
    desc: "Lightning-fast market scanning across multiple timeframes and assets, updated every second.",
  },
  {
    icon: "🎯",
    title: "Smart Signal Detection",
    desc: "AI identifies high-probability setups using pattern recognition and order-flow analysis.",
  },
  {
    icon: "🛡️",
    title: "Risk Management AI",
    desc: "Automated position sizing, stop-loss and drawdown protection to keep your capital safe.",
  },
  {
    icon: "📊",
    title: "Quantitative Models",
    desc: "Statistical and algorithmic strategies backtested across years of historical data.",
  },
  {
    icon: "🤖",
    title: "Full Automation",
    desc: "Set it and forget it. Our bots execute trades 24/7 without emotions or fatigue.",
  },
];

export default function Technology() {
  return (
    <section className="bg-[#050816] text-white py-24">
      <div className="max-w-7xl mx-auto px-6">
        {/* Heading */}
        <div className="text-center mb-16">
          <span className="text-blue-500 font-semibold tracking-wide uppercase text-sm">
            AI Technology
          </span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4">
            Powered by Advanced AI
          </h2>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto text-lg">
            Our trading systems combine cutting-edge machine learning,
            quantitative models and real-time data to give you an edge.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {FEATURES.map((feature, index) => (
            <div
              key={index}
              className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-8 hover:border-blue-500 transition duration-300"
            >
              <div className="w-14 h-14 rounded-xl bg-blue-600/20 flex items-center justify-center text-3xl mb-5">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
              <p className="text-gray-400 leading-7">{feature.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}