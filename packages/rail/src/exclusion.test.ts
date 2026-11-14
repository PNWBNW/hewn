import { SealanceMerkleTree } from "@provablehq/sdk";
import { describe, expect, it } from "vitest";
import { FREEZELIST_PROGRAM, TREE_DEPTH, ZERO_ADDRESS, buildExclusionProof, exclusionProofFor, fetchFreezeList, freezeListRoot } from "./exclusion";
import deployed from "./fixtures/freeze_list.json";
import { type RailNetwork, RailError, RailNetworkError } from "./types";

const FROZEN = [
  "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
  "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
];
const [A, B] = FROZEN as [string, string];
const SENDER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";
const BASE = `program/${FREEZELIST_PROGRAM}/mapping`;

/** The root of a list by the SDK's tree, apart from the code under test. */
const rootOf = (list: string[]): string => {
  const sdk = new SealanceMerkleTree();
  const tree = sdk.buildTree(sdk.generateLeaves(list, TREE_DEPTH));
  return `${tree[tree.length - 1]}field`;
};

/**
 * The freeze-list program's mappings the way the explorer serves them: `slots` is
 * `freeze_list_index` from 0 (an unfrozen slot holds the zero address), the last index is the last
 * slot, and a mapping or key that doesn't exist answers null, not an error.
 */
function freezeListNetwork(slots: string[], opts: { root?: string; lastIndex?: unknown } = {}): RailNetwork & { calls: string[] } {
  const calls: string[] = [];
  const root = opts.root ?? rootOf(slots.filter((a) => a !== ZERO_ADDRESS));
  return {
    calls,
    async fetchJson(path) {
      calls.push(path);
      if (path === `${BASE}/freeze_list_last_index/true`) return "lastIndex" in opts ? opts.lastIndex : `${slots.length - 1}u32`;
      const slot = new RegExp(`^${BASE}/freeze_list_index/(\\d+)u32$`).exec(path);
      if (slot) return slots[Number(slot[1])] ?? null;
      if (path === `${BASE}/freeze_list_root/1u8`) return root;
      return null;
    },
  };
}

/** The network answering exactly what the fixture recorded. */
function recordedNetwork(): RailNetwork {
  const mappings = deployed.mappings as Record<string, Record<string, string>>;
  return {
    async fetchJson(path) {
      const [mapping, key] = path.slice(BASE.length + 1).split("/");
      return (path.startsWith(`${BASE}/`) && mappings[mapping!]?.[key!]) || null;
    },
  };
}

/** The shape the deployed MerkleProof struct expects: two paths, 16 field siblings each, u32 leaf indices. */
const PROOF_SHAPE = /^\[\{siblings: \[((?:\d+field, ){15}\d+field)\], leaf_index: \d+u32\}, \{siblings: \[((?:\d+field, ){15}\d+field)\], leaf_index: \d+u32\}\]$/;

describe("exclusion proof", () => {
  it("formats two depth-16 sibling paths the way transfer_private takes them", () => {
    const proof = buildExclusionProof(SENDER, FROZEN);
    expect(proof).toMatch(PROOF_SHAPE);
    expect(TREE_DEPTH).toBe(16);
  });

  it("is the same for the same sender and list, and differs when the list changes", () => {
    expect(buildExclusionProof(SENDER, FROZEN)).toBe(buildExclusionProof(SENDER, FROZEN));
    expect(buildExclusionProof(SENDER, [])).toMatch(PROOF_SHAPE);
    expect(buildExclusionProof(SENDER, [])).not.toBe(buildExclusionProof(SENDER, FROZEN));
  });

  it("calls the SDK tree in the coordinator's order: leaves at depth 16, tree, both indices, two paths, one format", () => {
    const calls: string[] = [];
    const tree = {
      generateLeaves: (addresses: string[], depth?: number) => (calls.push(`leaves:${addresses.length}:${depth}`), ["0field", "1field"]),
      buildTree: (leaves: string[]) => (calls.push(`tree:${leaves.length}`), [0n, 1n, 2n]),
      getLeafIndices: (_t: bigint[], addr: string) => (calls.push(`indices:${addr.slice(0, 5)}`), [0, 1] as [number, number]),
      getSiblingPath: (_t: bigint[], leafIndex: number, depth: number) => (calls.push(`path:${leafIndex}:${depth}`), { siblings: Array<bigint>(depth).fill(0n), leaf_index: leafIndex }),
      formatMerkleProof: (proof: { siblings: bigint[]; leaf_index: number }[]) => (calls.push(`format:${proof.length}`), "FORMATTED"),
    };
    expect(buildExclusionProof(SENDER, FROZEN, tree)).toBe("FORMATTED");
    expect(calls).toEqual(["leaves:2:16", "tree:2", "indices:aleo1", "path:0:16", "path:1:16", "format:2"]);
  });

  it("reads freeze_list_index up to freeze_list_last_index and refuses on a root mismatch", async () => {
    const n = freezeListNetwork([ZERO_ADDRESS, A]);
    expect(await fetchFreezeList(n)).toEqual([A]);
    expect(n.calls).toEqual([`${BASE}/freeze_list_last_index/true`, `${BASE}/freeze_list_index/0u32`, `${BASE}/freeze_list_index/1u32`]);
    expect(await exclusionProofFor(SENDER, freezeListNetwork([ZERO_ADDRESS, A]))).toBe(buildExclusionProof(SENDER, [A]));
    // The chain's root is over two addresses and one was read: no proof is built.
    const short = exclusionProofFor(SENDER, freezeListNetwork([ZERO_ADDRESS, A], { root: rootOf([A, B]) }));
    await expect(short).rejects.toThrow(RailError);
    await expect(short).rejects.toThrow(/didn't read back whole, so nothing was sent/);
  });

  it("skips a slot that was unfrozen, and the root is the chain's with or without it", async () => {
    expect(await fetchFreezeList(freezeListNetwork([ZERO_ADDRESS, ZERO_ADDRESS, B]))).toEqual([B]);
    expect(freezeListRoot([B])).toBe(rootOf([ZERO_ADDRESS, ZERO_ADDRESS, B]));
    expect(freezeListRoot([A, B])).toBe(rootOf([B, A]));
    expect(await exclusionProofFor(SENDER, freezeListNetwork([ZERO_ADDRESS, ZERO_ADDRESS, B]))).toBe(buildExclusionProof(SENDER, [B]));
  });

  it("reads the deployed list as it stood with nobody frozen, and its root is the one on chain", async () => {
    expect(await fetchFreezeList(recordedNetwork())).toEqual([]);
    expect(freezeListRoot([])).toBe(deployed.mappings.freeze_list_root["1u8"]);
    expect(await exclusionProofFor(SENDER, recordedNetwork())).toBe(buildExclusionProof(SENDER, []));
  });

  it("refuses when the list can't be read, instead of proving over an empty one", async () => {
    const unreadable = /freeze list can't be read; nothing was sent/;
    await expect(exclusionProofFor(SENDER, { fetchJson: async () => null })).rejects.toThrow(unreadable);
    await expect(exclusionProofFor(SENDER, { fetchJson: async () => { throw new RailNetworkError("not found", 404); } })).rejects.toThrow(unreadable);
    for (const lastIndex of ["", "u32", "-1u32", "1.5u32", "70000u32", 3, "aleo1"]) {
      await expect(fetchFreezeList(freezeListNetwork([ZERO_ADDRESS], { lastIndex })), String(lastIndex)).rejects.toThrow(unreadable);
    }
    // A slot that holds something other than an account, and a root that isn't a field.
    await expect(fetchFreezeList(freezeListNetwork([ZERO_ADDRESS, "12u32"], { root: rootOf([]) }))).rejects.toThrow(unreadable);
    // An account-shaped slot the tree can't take (its checksum is wrong) is unreadable too, not a crash.
    await expect(exclusionProofFor(SENDER, freezeListNetwork([ZERO_ADDRESS, `aleo1${"q".repeat(58)}`], { root: rootOf([]) }))).rejects.toThrow(unreadable);
    await expect(exclusionProofFor(SENDER, freezeListNetwork([ZERO_ADDRESS], { root: "" }))).rejects.toThrow(unreadable);
  });

  it("refuses when the sender itself is on the list", async () => {
    const frozen = exclusionProofFor(SENDER, freezeListNetwork([ZERO_ADDRESS, A, SENDER]));
    await expect(frozen).rejects.toThrow(RailError);
    await expect(frozen).rejects.toThrow(/on the stablecoin's freeze list/);
  });

  it("passes a real network failure through", async () => {
    const n: RailNetwork = { fetchJson: async () => { throw new RailNetworkError("down", 503); } };
    await expect(fetchFreezeList(n)).rejects.toThrow(/down/);
    await expect(exclusionProofFor(SENDER, n)).rejects.toThrow(/down/);
  });
});
