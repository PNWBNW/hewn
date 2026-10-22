import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  // The same "@/…" alias as tsconfig.json, so a test can render a page that imports through it.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { name: "business", globals: true, environment: "node", include: ["src/**/*.test.ts"] },
});
