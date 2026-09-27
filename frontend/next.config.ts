import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sprint M12 branding follow-on - MarketplaceCatalogue.ts and
  // mt5EvidenceAdapter.ts both read data/marketplace-evidence/*.json via a
  // runtime-computed filename (readFileSync(join(dir, `${id}.json`))).
  // Next's automatic serverless-function file tracer only detects
  // statically-analyzable fs paths, not dynamically-built ones, so it was
  // silently dropping this directory from the deployed bundle - files
  // that exist and work locally, 404/ENOENT (caught, returns null) in
  // production. This explicit include is the documented fix (see
  // node_modules/next/dist/docs/.../output.md's own "Next.js might fail
  // to include required files" section).
  // AT24 Security Hardening P0 - app/api/private/licenses/[licenseId]/download/route.ts
  // reads paid EA binaries via path.join(process.cwd(), "private-releases", `${release.id}.ex5`)
  // - the exact same dynamically-computed-path problem as marketplace-evidence
  // above. Without this, buyers' paid downloads 404/500 in production even
  // though the .ex5 files are committed to the repo.
  outputFileTracingIncludes: {
    "/*": ["data/marketplace-evidence/**/*", "private-releases/**/*"],
  },
};

export default nextConfig;
