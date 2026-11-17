import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The update worker in a real browser (test/worker/update_worker.browser.test.ts). Not part of
// `pnpm test`: the root runs only `vitest.config.ts` files, and CI has no Chromium. Run with
// `pnpm --filter @pnw/business test:worker` after `build:static` (it builds the bundle if `out/`
// is missing).
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "business-worker",
    environment: "node",
    include: ["test/worker/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 600_000,
    // One browser, one device: the tests run in order and build on each other.
    sequence: { concurrent: false },
  },
});
