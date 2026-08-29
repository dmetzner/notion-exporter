import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  sourcemap: true,
  // No `__dirname`/`__filename` usage in `src/cli.ts` (Node 20+ ESM is native);
  // disabling shims trims the bundle. Verified via `grep -rn __dirname src/`.
  shims: false,
  banner: { js: "#!/usr/bin/env node" },
});
