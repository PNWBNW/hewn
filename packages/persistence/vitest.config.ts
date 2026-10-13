import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "persistence", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
