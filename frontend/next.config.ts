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
  outputFileTracingIncludes: {
    "/*": ["data/marketplace-evidence/**/*"],
  },
};

export default nextConfig;
