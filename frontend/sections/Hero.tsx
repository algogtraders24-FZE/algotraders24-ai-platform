export default function Hero() {
  return (
    <section className="min-h-screen flex items-center bg-[#050816] text-white pt-20">
      <div className="max-w-7xl mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">

        {/* Left Side */}

        <div>
          <span className="inline-block bg-blue-600/20 text-blue-400 px-4 py-2 rounded-full mb-6">
            AI Powered Trading Platform
          </span>

          <h1 className="text-5xl md:text-7xl font-bold leading-tight">
            Next Generation
            <br />
            AI Trading
            <span className="text-blue-500"> Intelligence</span>
          </h1>

          <p className="mt-8 text-gray-400 text-lg leading-8 max-w-xl">
            Enterprise-grade AI trading software built for Forex,
            Crypto, US Stocks, Gold and Index markets.
            Intelligent automation. Professional performance.
          </p>

          <div className="mt-10 flex gap-4">

            <button className="bg-blue-600 hover:bg-blue-700 px-8 py-4 rounded-xl font-semibold transition">
              Explore Products
            </button>

            <button className="border border-gray-600 hover:border-blue-500 px-8 py-4 rounded-xl font-semibold transition">
              Book Demo
            </button>

          </div>
        </div>

        {/* Right Side */}

        <div className="flex justify-center">

          <div className="w-full max-w-md rounded-3xl bg-white/5 border border-white/10 backdrop-blur-lg p-8">

            <h3 className="text-2xl font-bold mb-6">
              AI Market Dashboard
            </h3>

            <div className="space-y-5">

              <div className="flex justify-between">
                <span>Forex</span>
                <span className="text-green-400">▲ +3.25%</span>
              </div>

              <div className="flex justify-between">
                <span>Gold</span>
                <span className="text-green-400">▲ +1.74%</span>
              </div>

              <div className="flex justify-between">
                <span>US Stocks</span>
                <span className="text-green-400">▲ +5.18%</span>
              </div>

              <div className="flex justify-between">
                <span>Crypto</span>
                <span className="text-red-400">▼ -0.84%</span>
              </div>

            </div>

            <div className="mt-8 h-40 rounded-xl bg-gradient-to-r from-blue-500 via-cyan-500 to-purple-600 flex items-center justify-center text-xl font-bold">
              AI Neural Engine
            </div>

          </div>

        </div>

      </div>
    </section>
  );
}