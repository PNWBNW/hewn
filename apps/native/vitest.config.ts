import { defineProject } from "vitest/config";

// The JavaScript side of the native verifier's tests: the fixtures its Rust tests check are made
// here by @pnw/ledger's own code (scripts/period_fixture.test.ts).
export default defineProject({
  test: { name: "native", globals: true, environment: "node", include: ["scripts/**/*.test.ts"] },
});
