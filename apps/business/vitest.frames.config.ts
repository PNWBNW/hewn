import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The top-page guard in a real browser (test/frames/frame_guard.frames.test.ts). Not part of
// `pnpm test`: the root runs only `vitest.config.ts` files, and CI has no Chromium. Run with
// `pnpm --filter @pnw/business test:frames` after `build:static`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    name: "business-frames",
    environment: "node",
    include: ["test/frames/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 600_000,
    // Print the guard's measured cost (the last test) even when it passes.
    silent: false,
  },
});
