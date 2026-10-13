import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "commitments", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
