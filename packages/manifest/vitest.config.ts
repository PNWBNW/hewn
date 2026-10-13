import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "manifest", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
