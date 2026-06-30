export default function CTA() {
  return (
    <section className="bg-[#050816] text-white py-24">
      <div className="max-w-5xl mx-auto px-6">
        <div className="rounded-3xl bg-gradient-to-r from-blue-600 via-blue-700 to-purple-700 p-12 md:p-16 text-center relative overflow-hidden">
          <h2 className="text-3xl md:text-5xl font-bold leading-tight">
            Ready to Trade Smarter
            <br />
            with AI?
          </h2>
          <p className="text-blue-100 mt-6 text-lg max-w-2xl mx-auto">
            Join thousands of traders using Algotraders24 AI to automate
            their trading across Forex, Crypto, Stocks and more.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <button className="bg-white text-blue-700 hover:bg-gray-100 px-8 py-4 rounded-xl font-semibold transition">
              Get Started Free
            </button>
            <button className="border border-white/40 hover:border-white px-8 py-4 rounded-xl font-semibold transition">
              Book a Demo
            </button>
          </div>
          <p className="text-blue-200 text-sm mt-6">
            No credit card required • Cancel anytime
          </p>
        </div>
      </div>
    </section>
  );
}