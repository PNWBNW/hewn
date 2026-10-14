import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "rail", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
