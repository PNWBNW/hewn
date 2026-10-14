import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "mailbox", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
