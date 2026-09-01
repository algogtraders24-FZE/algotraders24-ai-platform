import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // P3.2A.1 - vendor/at24-quant-engine/dist is a BUILT artifact (compiled
    // output of a separate package's own TypeScript), not hand-written
    // source of this app - same reasoning as ignoring node_modules.
    "vendor/**",
  ]),
  // 15A.2: silence cosmetic rules newly enforced by Next 16.
  // set-state-in-effect is a false positive for fetch-on-mount ([] deps).
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
export default eslintConfig;
