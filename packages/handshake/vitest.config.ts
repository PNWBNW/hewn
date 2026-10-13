import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "handshake", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
