import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Algotraders24 AI - Next Generation AI Trading Platform",
  description: "Premium AI trading software for Forex, Crypto, Stocks, Gold and Indian markets. Expert Advisors, indicators and bots.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}