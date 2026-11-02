import { describe, expect, it } from "vitest";
import { anchorCall } from "./close_anchor";

describe("anchoring a close", () => {
  it("sends the root as 32 bytes to payroll_audit_log's anchor_event, with a public fee", () => {
    const call = anchorCall("00ff".repeat(16));
    expect(call).toMatchObject({ program: "payroll_audit_log.aleo", function: "anchor_event", feeMode: "public" });
    expect(call.inputs).toHaveLength(1);
    expect(call.inputs[0]!.match(/u8/g)).toHaveLength(32);
    expect(call.inputs[0]!.startsWith("[ 0u8, 255u8, 0u8")).toBe(true);
  });

  it("refuses anything that isn't a root", () => {
    expect(() => anchorCall("nope")).toThrow(/64 hex/);
    expect(() => anchorCall("A".repeat(64))).toThrow(/64 hex/);
  });
});
