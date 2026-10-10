// app/manifest.ts
// The AT24 web app manifest: makes the site installable ("Add to Home Screen" / "Install app") and gives it an app-like
// window. Colors and icons come from the brand (deep black #0b0f19 and the AT24 mark). start_url is the dashboard: a signed-out
// visitor is sent to the login page, as for any dashboard link.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AT24 - Algotraders24 AI",
    short_name: "AT24",
    description: "AI trading intelligence for MT4/MT5 traders: Live Results, alerts, Edge Analyzer and the marketplace.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0f19",
    theme_color: "#0b0f19",
    lang: "en",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Live Results", short_name: "Results", url: "/dashboard/live-results", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Live Sync", short_name: "Live Sync", url: "/dashboard/live-sync", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "Marketplace", short_name: "Market", url: "/marketplace", icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
