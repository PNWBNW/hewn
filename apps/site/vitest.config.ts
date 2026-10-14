import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "site", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
