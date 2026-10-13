import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "nft-art", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
