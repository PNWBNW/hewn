import { describe, expect, it } from "vitest";
import { approvalsWaiting, awaitingPhone, subscribeApprovals } from "./phone_approval";

describe("approvals waiting on the phone", () => {
  it("counts an approval from the moment it is asked until it is answered", async () => {
    let answer!: (value: string) => void;
    const seen: number[] = [];
    const stop = subscribeApprovals(() => seen.push(approvalsWaiting()));
    const pending = awaitingPhone(() => new Promise<string>((resolve) => (answer = resolve)));
    expect(approvalsWaiting()).toBe(1);
    answer("at1tx");
    await expect(pending).resolves.toBe("at1tx");
    expect(approvalsWaiting()).toBe(0);
    expect(seen).toEqual([1, 0]);
    stop();
  });

  it("stops counting a refused approval, and passes the refusal on unchanged", async () => {
    const refusal = new Error("User rejected");
    await expect(awaitingPhone(() => Promise.reject(refusal))).rejects.toBe(refusal);
    expect(approvalsWaiting()).toBe(0);
  });

  it("counts several at once, and stops telling a listener once it unsubscribes", async () => {
    let calls = 0;
    const stop = subscribeApprovals(() => (calls += 1));
    const answers: Array<() => void> = [];
    const a = awaitingPhone(() => new Promise<void>((r) => answers.push(r)));
    const b = awaitingPhone(() => new Promise<void>((r) => answers.push(r)));
    expect(approvalsWaiting()).toBe(2);
    stop();
    answers.forEach((r) => r());
    await Promise.all([a, b]);
    expect(approvalsWaiting()).toBe(0);
    expect(calls).toBe(2);
  });
});
