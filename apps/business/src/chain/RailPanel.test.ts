import { describe, expect, it } from "vitest";
import { PROGRAM_ADDRESSES } from "@pnw/config/programs";
import type { WorkerRecord } from "@pnw/records/types/worker";
import { toLink } from "./RailPanel";

const KEY = "ab".repeat(32);
const record = (worker_addr: string): WorkerRecord => ({ worker_addr, worker_name_hash: "77field", agreement_id: "01".repeat(32), status: "active" });

describe("importing a team member from an agreement", () => {
  it("links the account the agreement names", () => {
    const address = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
    expect(toLink("wkr-1", record(address), KEY)).toMatchObject({ workerId: "wkr-1", address, partiesKey: KEY, status: "linked" });
  });

  it("doesn't link an agreement whose account nobody holds: the zero address or a program's", () => {
    const refusal = "This agreement's account isn't a person's or a business's, so it can't be linked";
    expect(() => toLink("wkr-1", record("aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc"), KEY)).toThrow(refusal);
    for (const program of Object.values(PROGRAM_ADDRESSES)) expect(() => toLink("wkr-1", record(program), KEY), program).toThrow(refusal);
  });
});
