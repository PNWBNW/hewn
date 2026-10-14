import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "security", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
