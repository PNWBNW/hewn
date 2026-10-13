import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "records", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
