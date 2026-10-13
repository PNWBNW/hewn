import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "payroll", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
