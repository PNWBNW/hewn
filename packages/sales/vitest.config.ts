import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "sales", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
