import { beforeEach, describe, expect, it, vi } from "vitest";

// The registry lookups go to the explorer; stub them so the parse test is offline.
vi.mock("./registry/name_registry", () => ({
  queryWorkerName: vi.fn(),
  queryNamePlaintext: vi.fn(),
}));

import { queryNamePlaintext, queryWorkerName } from "./registry/name_registry";
import { scanAgreementRecords } from "./agreement_reader";

const EMPLOYER = "aleo1employer00000000000000000000000000000000000000000000000000";
const WORKER_A = "aleo1workera000000000000000000000000000000000000000000000000000";
const WORKER_B = "aleo1workerb000000000000000000000000000000000000000000000000000";
const OTHER_EMPLOYER = "aleo1other0000000000000000000000000000000000000000000000000000000";

const bytes32 = (fill: number) => `[ ${Array.from({ length: 32 }, () => `${fill}u8`).join(", ")} ]`;

/** A FinalAgreement record plaintext as the wallet returns it (fields from employer_agreement_v4). */
function finalAgreement(opts: { employer: string; worker: string; idByte: number; nameHash: string }): string {
  return [
    "{",
    `  owner: ${opts.employer}.private,`,
    `  agreement_id: ${bytes32(opts.idByte)}.private,`,
    `  parties_key: ${bytes32(9)}.private,`,
    "  employer_name_hash: 111field.private,",
    `  worker_name_hash: ${opts.nameHash}field.private,`,
    "  industry_code: 9u8.private,",
    "  pay_frequency_code: 2u8.private,",
    "  start_epoch: 20260101u32.private,",
    "  end_epoch: 0u32.private,",
    "  review_epoch: 20270101u32.private,",
    "  agreement_rev: 1u16.private,",
    "  schema_v: 2u16.private,",
    "  policy_v: 1u16.private,",
    `  terms_doc_hash: ${bytes32(3)}.private,`,
    `  terms_root: ${bytes32(4)}.private,`,
    "  offer_height: 100u32.private,",
    `  offer_time_hash: ${bytes32(5)}.private,`,
    "  accept_height: 120u32.private,",
    `  accept_time_hash: ${bytes32(6)}.private,`,
    `  employer_address: ${opts.employer}.private,`,
    `  worker_address: ${opts.worker}.private,`,
    "  _nonce: 123group.public",
    "}",
  ].join("\n");
}

const record = (recordName: string, recordPlaintext: string, spent = false) => ({ recordName, recordPlaintext, spent });

beforeEach(() => {
  vi.mocked(queryWorkerName).mockReset();
  vi.mocked(queryNamePlaintext).mockReset();
});

describe("scanAgreementRecords", () => {
  it("parses FinalAgreement records into worker rows with bare registered names", async () => {
    const records = [
      record("FinalAgreement", finalAgreement({ employer: EMPLOYER, worker: WORKER_A, idByte: 1, nameHash: "222" })),
      record("FinalAgreement", finalAgreement({ employer: EMPLOYER, worker: WORKER_B, idByte: 2, nameHash: "333" })),
    ];
    vi.mocked(queryWorkerName).mockImplementation(async (addr) => (addr === WORKER_A ? "222field" : null));
    vi.mocked(queryNamePlaintext).mockResolvedValue("ana");

    const requestRecords = vi.fn(async () => records);
    const workers = await scanAgreementRecords(requestRecords, EMPLOYER);

    expect(requestRecords).toHaveBeenCalledWith("employer_agreement_v4.aleo", true);
    expect(workers).toEqual([
      { worker_addr: WORKER_A, worker_name_hash: "222", agreement_id: "01".repeat(32), status: "active", display_name: "ana" },
      { worker_addr: WORKER_B, worker_name_hash: "333", agreement_id: "02".repeat(32), status: "active", display_name: undefined },
    ]);
    expect(queryNamePlaintext).toHaveBeenCalledWith("222");
  });

  it("skips spent records, other record types, other employers' agreements and duplicates", async () => {
    const mine = finalAgreement({ employer: EMPLOYER, worker: WORKER_A, idByte: 7, nameHash: "1" });
    const records = [
      record("FinalAgreement", mine, true),
      record("PaystubReceipt", mine),
      record("FinalAgreement", finalAgreement({ employer: OTHER_EMPLOYER, worker: WORKER_B, idByte: 8, nameHash: "1" })),
      record("FinalAgreement", mine),
      record("FinalAgreement", mine),
      { recordName: "FinalAgreement" }, // no plaintext at all
    ];
    vi.mocked(queryWorkerName).mockResolvedValue(null);

    const workers = await scanAgreementRecords(async () => records, EMPLOYER);
    expect(workers.map((w) => w.agreement_id)).toEqual(["07".repeat(32)]);
  });

  it("keeps the rows when a name lookup throws, and asks for every name at once", async () => {
    const records = [
      record("FinalAgreement", finalAgreement({ employer: EMPLOYER, worker: WORKER_A, idByte: 1, nameHash: "1" })),
      record("FinalAgreement", finalAgreement({ employer: EMPLOYER, worker: WORKER_B, idByte: 2, nameHash: "2" })),
    ];
    let pending = 0;
    let peak = 0;
    vi.mocked(queryWorkerName).mockImplementation(async (addr) => {
      peak = Math.max(peak, ++pending);
      await new Promise((r) => setTimeout(r, 5));
      pending--;
      if (addr === WORKER_A) throw new Error("explorer down");
      return null;
    });

    const workers = await scanAgreementRecords(async () => records, EMPLOYER);
    expect(workers).toHaveLength(2);
    expect(peak).toBe(2);
  });

  it("returns nothing when the wallet can't list records", async () => {
    expect(
      await scanAgreementRecords(async () => {
        throw new Error("no");
      }, EMPLOYER),
    ).toEqual([]);
  });
});
