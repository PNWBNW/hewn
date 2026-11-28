import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "hqc", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
