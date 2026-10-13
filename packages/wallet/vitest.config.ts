import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "wallet", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
