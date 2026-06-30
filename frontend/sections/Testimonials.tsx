const REVIEWS = [
  {
    name: "Rajesh Kumar",
    role: "Forex Trader, India",
    text: "The AI Trend Master EA completely changed my trading. Consistent results and zero emotional stress. Best investment I made this year.",
    initial: "R",
  },
  {
    name: "Sarah Mitchell",
    role: "Crypto Investor, UK",
    text: "Quantum Scalper Pro runs 24/7 and catches moves I would have missed. The risk management gives me real peace of mind.",
    initial: "S",
  },
  {
    name: "Ahmed Al-Farsi",
    role: "Fund Manager, UAE",
    text: "Professional-grade tools at a fair price. The quantitative models are genuinely impressive. My clients are very happy.",
    initial: "A",
  },
  {
    name: "Priya Sharma",
    role: "NIFTY Trader, India",
    text: "NIFTY Algo Pro understands the Indian market perfectly. Intraday signals are sharp and the support team is excellent.",
    initial: "P",
  },
  {
    name: "David Chen",
    role: "Day Trader, Singapore",
    text: "I tried many bots before, but this is on another level. The Smart Money Indicator alone is worth the entire price.",
    initial: "D",
  },
  {
    name: "Maria Garcia",
    role: "Swing Trader, Spain",
    text: "Setup was easy even for a non-techie like me. The AI does the hard work while I focus on my strategy. Highly recommend.",
    initial: "M",
  },
];

export default function Testimonials() {
  return (
    <section className="bg-[#050816] text-white py-24">
      <div className="max-w-7xl mx-auto px-6">
        {/* Heading */}
        <div className="text-center mb-16">
          <span className="text-blue-500 font-semibold tracking-wide uppercase text-sm">
            Testimonials
          </span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4">
            Loved by Traders Worldwide
          </h2>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto text-lg">
            Join thousands of traders who trust Algotraders24 AI to
            power their daily trading.
          </p>
        </div>

        {/* Review Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {REVIEWS.map((review, index) => (
            <div
              key={index}
              className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-8 hover:border-blue-500 transition duration-300"
            >
              {/* Stars */}
              <div className="text-yellow-400 mb-4">★★★★★</div>

              {/* Review text */}
              <p className="text-gray-300 leading-7 mb-6">"{review.text}"</p>

              {/* Person */}
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center font-bold text-lg">
                  {review.initial}
                </div>
                <div>
                  <div className="font-semibold">{review.name}</div>
                  <div className="text-gray-400 text-sm">{review.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}