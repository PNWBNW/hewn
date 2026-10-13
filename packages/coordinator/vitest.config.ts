import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "coordinator", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
