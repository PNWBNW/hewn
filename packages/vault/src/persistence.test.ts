import { describe, expect, it, vi } from "vitest";
import { persistence, requestPersistence } from "./persistence";

describe("asking the browser to keep the vault", () => {
  it("says so when the browser already keeps it, and doesn't ask again", async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistence({ persisted: async () => true, persist })).toBe("persistent");
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks when it isn't kept yet, and reports the browser's answer", async () => {
    expect(await requestPersistence({ persisted: async () => false, persist: async () => true })).toBe("persistent");
    expect(await requestPersistence({ persisted: async () => false, persist: async () => false })).toBe("best_effort");
  });

  it("never throws: a refusal or an error leaves it best effort, and no storage API is 'unsupported'", async () => {
    expect(await requestPersistence({ persisted: async () => false, persist: async () => Promise.reject(new Error("no")) })).toBe("best_effort");
    expect(await requestPersistence({ persisted: async () => Promise.reject(new Error("no")) })).toBe("unsupported");
    expect(await requestPersistence(undefined)).toBe("unsupported");
    expect(await requestPersistence({})).toBe("unsupported");
    expect(await persistence({ persisted: async () => false })).toBe("best_effort");
  });
});
