const FOOTER_LINKS = {
  Products: ["MT5 Expert Advisors", "TradingView Indicators", "cTrader cBots", "Crypto Bots", "Indian Market Algos"],
  Company: ["About Us", "Pricing", "Contact", "Careers", "Blog"],
  Resources: ["AI Academy", "Documentation", "Market Intelligence", "Support", "FAQ"],
  Legal: ["Terms of Service", "Privacy Policy", "Risk Disclaimer", "Refund Policy"],
};

export default function Footer() {
  return (
    <footer className="bg-[#0C1324] text-white border-t border-[#1F2937] pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid md:grid-cols-5 gap-10">
          <div className="md:col-span-1">
            <h3 className="text-xl font-bold">
              Algotraders<span className="text-blue-500">24</span> AI
            </h3>
            <p className="text-gray-400 text-sm mt-4 leading-6">
              Next generation AI trading software for global markets.
              Intelligent automation. Professional performance.
            </p>
          </div>

          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading}>
              <h4 className="font-semibold mb-4">{heading}</h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link}>
                    <a href="#" className="text-gray-400 text-sm hover:text-blue-400 transition">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-[#1F2937] mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-gray-400 text-sm">
            © 2026 Algotraders24 AI. All rights reserved.
          </p>
          <p className="text-gray-500 text-xs max-w-2xl text-center md:text-right">
            Trading involves risk. Past performance does not guarantee future results.
          </p>
        </div>
      </div>
    </footer>
  );
}