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
    // Local-only runtime data (embedded Postgres data dir, desktop browser
    // profile, jwt secret) — gitignored, not source, was being linted as
    // if it were app code and drowning real findings in noise.
    "warecore-data/**",
    "WC-Installer/dist/**",
    "WC-Installer/node-runtime/**",
  ]),
]);

export default eslintConfig;
