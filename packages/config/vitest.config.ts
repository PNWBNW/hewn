import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "config", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
