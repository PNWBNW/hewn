import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "ledger", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
