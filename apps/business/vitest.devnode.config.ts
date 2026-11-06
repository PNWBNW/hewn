import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// End-to-end tests against a local Aleo node (test/devnode/README.md). Not part of `pnpm test`: the
// root runs only `vitest.config.ts` files. Run with `pnpm --filter @pnw/business test:devnode`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "business-devnode",
    environment: "node",
    include: ["test/devnode/**/*.test.ts"],
    // One node for the whole run, so the files run one after another.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
