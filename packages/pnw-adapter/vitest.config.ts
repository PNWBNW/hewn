import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "pnw-adapter", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
