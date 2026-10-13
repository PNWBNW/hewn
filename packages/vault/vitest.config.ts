import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "vault", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
