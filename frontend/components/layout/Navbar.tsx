"use client";

// Sprint H1.3 - Rebuilt per the approved Sprint H1.2B specification:
// professional, minimal, sticky, keyboard accessible, no placeholder
// links. The scroll-crossfade (transparent -> solid glass surface) is the
// only interaction here that genuinely needs JavaScript - everything else
// (hover, focus) is plain CSS.
//
// Sprint D2.4.A1 - extended from 2 flat links to the approved IA: Platform/
// Solutions/Resources/Company are dropdowns, each showing only real,
// working destinations (no href="#", matching Footer.tsx's own established
// rule). Desktop dropdowns open on hover/focus; mobile collapses each into
// an accordion inside the existing sheet. Every dropdown parent is itself a
// real link to its hub page, not a non-clickable label.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu, X, ChevronDown } from "lucide-react";
import BrandLogo from "@/components/brand/BrandLogo";

const SCROLL_THRESHOLD = 80;

interface NavChild {
  label: string;
  href: string;
}
interface NavItem {
  label: string;
  href: string;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Products", href: "/products" },
  {
    label: "Platform",
    href: "/platform",
    children: [
      { label: "AI Assistant", href: "/platform/assistant" },
      { label: "Market Intelligence", href: "/platform/market-intelligence" },
      { label: "Trading Workspace", href: "/platform/workspace" },
      { label: "Publishing", href: "/platform/publishing" },
      { label: "Knowledge Base", href: "/platform/knowledge-base" },
    ],
  },
  {
    label: "Solutions",
    href: "/solutions",
    children: [
      { label: "Retail Traders", href: "/solutions/retail-traders" },
      { label: "Professional Traders", href: "/solutions/professional-traders" },
    ],
  },
  { label: "Pricing", href: "/pricing" },
  {
    label: "Resources",
    href: "/resources",
    children: [{ label: "FAQ", href: "/resources/faq" }],
  },
  {
    label: "Company",
    href: "/company",
    children: [
      { label: "About", href: "/company/about" },
      { label: "Vision", href: "/company/vision" },
      { label: "Contact", href: "/company/contact" },
      { label: "Disclaimer", href: "/company/disclaimer" },
    ],
  },
];

function DesktopDropdown({ item }: { item: NavItem }) {
  if (!item.children) {
    return (
      <Link href={item.href} className="transition-colors hover:text-text">
        {item.label}
      </Link>
    );
  }
  return (
    <div className="group relative">
      <Link href={item.href} className="flex items-center gap-1 transition-colors hover:text-text">
        {item.label}
        <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-hover:rotate-180" aria-hidden="true" />
      </Link>
      <div className="invisible absolute left-1/2 top-full mt-2 w-56 -translate-x-1/2 rounded-card border border-border bg-ink-2 p-2 opacity-0 shadow-raised transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {item.children.map((child) => (
          <Link
            key={child.href}
            href={child.href}
            className="block rounded-control px-3 py-2 text-sm text-text-2 transition-colors hover:bg-ink-3 hover:text-text"
          >
            {child.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function MobileAccordion({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  if (!item.children) {
    return (
      <Link href={item.href} className="text-text-2 hover:text-text" onClick={onNavigate}>
        {item.label}
      </Link>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-text-2 hover:text-text"
      >
        {item.label}
        <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3 border-l border-border pl-4">
          <Link href={item.href} className="text-sm text-text-3 hover:text-text" onClick={onNavigate}>
            All {item.label}
          </Link>
          {item.children.map((child) => (
            <Link key={child.href} href={child.href} className="text-sm text-text-2 hover:text-text" onClick={onNavigate}>
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

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
          <span className="hidden sm:inline-flex">
            <BrandLogo variant="full" size="sm" withDescriptor={false} />
          </span>
          <span className="sm:hidden">
            <BrandLogo variant="icon" className="h-7" />
          </span>
        </Link>

        <div className="hidden lg:flex items-center gap-7 text-sm text-text-2">
          <Link href="/" className="transition-colors hover:text-text">
            Home
          </Link>
          {NAV_ITEMS.map((item) => (
            <DesktopDropdown key={item.href} item={item} />
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-5">
          <Link href="/login" className="text-sm font-medium text-text-2 transition-colors hover:text-text">
            Login
          </Link>
          <Link
            href="/dashboard/assistant"
            className="inline-flex rounded-control bg-gold px-5 py-2 text-sm font-semibold text-ink transition hover:brightness-110"
          >
            Ask the AI Assistant
          </Link>
        </div>

        <button
          type="button"
          className="text-text lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={24} aria-hidden="true" /> : <Menu size={24} aria-hidden="true" />}
        </button>
      </nav>

      {open && (
        <div id="mobile-menu" className="flex max-h-[calc(100vh-5rem)] flex-col gap-5 overflow-y-auto border-t border-border bg-ink px-6 py-6 lg:hidden">
          <Link href="/" className="text-text-2 hover:text-text" onClick={() => setOpen(false)}>
            Home
          </Link>
          {NAV_ITEMS.map((item) => (
            <MobileAccordion key={item.href} item={item} onNavigate={() => setOpen(false)} />
          ))}
          <Link href="/login" className="text-text-2 hover:text-text" onClick={() => setOpen(false)}>
            Login
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
