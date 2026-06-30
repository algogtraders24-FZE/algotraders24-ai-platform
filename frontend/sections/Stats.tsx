const STATS = [
  { value: "50,000+", label: "Active Traders", sub: "Worldwide" },
  { value: "87%", label: "Average Win Rate", sub: "Across strategies" },
  { value: "$2.4B+", label: "Volume Traded", sub: "And growing" },
  { value: "99.9%", label: "Uptime", sub: "Always running" },
];

export default function Stats() {
  return (
    <section className="bg-[#0C1324] text-white py-24 border-y border-[#1F2937]">
      <div className="max-w-7xl mx-auto px-6">
        {/* Heading */}
        <div className="text-center mb-16">
          <span className="text-blue-500 font-semibold tracking-wide uppercase text-sm">
            Trusted Worldwide
          </span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4">
            Numbers That Speak
          </h2>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto text-lg">
            Thousands of traders trust Algotraders24 AI to power their
            trading every single day.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
          {STATS.map((stat, index) => (
            <div
              key={index}
              className="text-center rounded-2xl bg-[#111827] border border-[#1F2937] p-8 hover:border-blue-500 transition duration-300"
            >
              <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
                {stat.value}
              </div>
              <div className="text-lg font-semibold mt-3">{stat.label}</div>
              <div className="text-gray-400 text-sm mt-1">{stat.sub}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}