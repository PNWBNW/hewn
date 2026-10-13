import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "ui", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
