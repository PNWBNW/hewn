import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "desktop", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
