import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "pair-keys", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
