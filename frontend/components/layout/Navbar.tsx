"use client";

// Sprint H1.3 - Rebuilt per the approved Sprint H1.2B specification:
// professional, minimal, sticky, keyboard accessible, no placeholder
// links. The scroll-crossfade (transparent -> solid glass surface) is the
// only interaction here that genuinely needs JavaScript - everything else
// (hover, focus) is plain CSS.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import BrandLogo from "@/components/brand/BrandLogo";

const SCROLL_THRESHOLD = 80;

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > SCROLL_THRESHOLD);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 border-b transition-colors duration-200 ${
        scrolled ? "glass-surface" : "bg-transparent border-transparent"
      }`}
    >
      <nav className="max-w-7xl mx-auto flex items-center justify-between h-20 px-6">
        <Link href="/" aria-label="Algotraders24 AI home" className="flex items-center">
          {/* Wrap in visibility spans rather than passing `hidden`/`sm:*`
              display classes to BrandLogo, whose root is already inline-flex
              — passing a conflicting `hidden` there loses to that base class
              in Tailwind's source order and leaks the full logo onto mobile
              (both marks showing). The wrapper span owns display state. */}
          <span className="hidden sm:inline-flex">
            <BrandLogo variant="full" size="sm" withDescriptor={false} />
          </span>
          <span className="sm:hidden">
            <BrandLogo variant="icon" className="h-7" />
          </span>
        </Link>

        <div className="hidden md:flex items-center gap-8 text-sm text-text-2">
          <Link href="/" className="transition-colors hover:text-text">
            Home
          </Link>
          <Link href="/products" className="transition-colors hover:text-text">
            Products
          </Link>
        </div>

        <Link
          href="/dashboard/assistant"
          className="hidden md:inline-flex rounded-control bg-gold px-5 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
        >
          Ask the AI Assistant
        </Link>

        <button
          type="button"
          className="text-text md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="flex flex-col gap-4 border-t border-border bg-ink px-6 py-6 md:hidden">
          <Link href="/" className="text-text-2 hover:text-text" onClick={() => setOpen(false)}>
            Home
          </Link>
          <Link href="/products" className="text-text-2 hover:text-text" onClick={() => setOpen(false)}>
            Products
          </Link>
          <Link
            href="/dashboard/assistant"
            className="rounded-control bg-gold px-5 py-2 text-center font-semibold text-ink"
            onClick={() => setOpen(false)}
          >
            Ask the AI Assistant
          </Link>
        </div>
      )}
    </header>
  );
}
