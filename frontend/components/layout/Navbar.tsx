"use client";

import Link from "next/link";

export default function Navbar() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-[#050816]/80 backdrop-blur-lg border-b border-white/10">
      <nav className="max-w-7xl mx-auto flex items-center justify-between h-20 px-6">

        {/* Logo */}
        <Link href="/" className="text-2xl font-bold text-white">
          Algotraders24 AI
        </Link>

        {/* Menu */}
        <div className="hidden md:flex items-center gap-8 text-gray-300">

          <Link href="/">Home</Link>

          <Link href="/">Products</Link>

          <Link href="/">Solutions</Link>

          <Link href="/">Pricing</Link>

          <Link href="/">About</Link>

        </div>

        {/* Button */}

        <button className="bg-blue-600 hover:bg-blue-700 transition px-5 py-2 rounded-lg text-white font-medium">

          Get Started

        </button>

      </nav>
    </header>
  );
}