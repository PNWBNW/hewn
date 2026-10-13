import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "business", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
