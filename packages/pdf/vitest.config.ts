import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "pdf", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
