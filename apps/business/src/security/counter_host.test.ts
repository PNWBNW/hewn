import { describe, expect, it } from "vitest";
import { COUNTER_PATHS, offCounterPath } from "./counter_host";

const own = { appUrl: "https://app.example", counterUrl: "https://count.example" };
const shared = { appUrl: "https://app.example", counterUrl: "https://app.example" };

describe("the counter's own address", () => {
  it("answers the two counter paths and nothing else", () => {
    expect([...COUNTER_PATHS]).toEqual(["/api/count", "/api/traction"]);
    expect(offCounterPath("count.example", "/api/count", own)).toBe(false);
    expect(offCounterPath("count.example", "/api/traction", own)).toBe(false);
    expect(offCounterPath("count.example", "/api/traction/", own)).toBe(false);
    expect(offCounterPath("COUNT.example", "/api/count", own)).toBe(false);
    for (const path of ["/", "/settings", "/traction", "/api", "/api/counts", "/api/count/x", "/out-of-the-basement"]) {
      expect(offCounterPath("count.example", path, own)).toBe(true);
    }
  });

  it("leaves the app's own address alone, and changes nothing while the counter shares it", () => {
    expect(offCounterPath("app.example", "/settings", own)).toBe(false);
    expect(offCounterPath(null, "/settings", own)).toBe(false);
    expect(offCounterPath("app.example", "/settings", shared)).toBe(false);
    expect(offCounterPath("app.example", "/api/count", shared)).toBe(false);
  });

  it("follows the brand by default", () => {
    expect(typeof offCounterPath("example.invalid", "/")).toBe("boolean");
    expect(offCounterPath("example.invalid", "/")).toBe(false);
  });
});
