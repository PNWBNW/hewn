import { describe, expect, it } from "vitest";
import { FREEZELIST_PROGRAM, TREE_DEPTH, buildExclusionProof, exclusionProofFor, fetchFreezeList } from "./exclusion";
import { type RailNetwork, RailNetworkError } from "./types";

const FROZEN = [
  "aleo1rhgdu77hgyqd3xjj8ucu3jj9r2krwz6mnzyd80gncr5fxcwlh5rsvzp9px",
  "aleo1s3ws5tra87fjycnjrwsjcrnw2qxr8jfqqdugnf0xzqqw29q9m5pqem2u4t",
];
const SENDER = "aleo1kypwp5m7qtk9mwazgcpg0tq8aal23mnrvwfvug65qgcg9xvsrqgspyjm6n";

function freezeListNetwork(addresses: string[]): RailNetwork & { calls: string[] } {
  const calls: string[] = [];
  const base = `program/${FREEZELIST_PROGRAM}/mapping`;
  return {
    calls,
    async fetchJson(path) {
      calls.push(path);
      if (path === `${base}/freeze_list_count/1u8`) {
        if (addresses.length === 0) throw new RailNetworkError("not found", 404);
        return `${addresses.length}u32`;
      }
      const m = /freeze_list\/(\d+)u32$/.exec(path);
      if (m && addresses[Number(m[1])]) return addresses[Number(m[1])];
      throw new RailNetworkError("not found", 404);
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

  it("reads the freeze list from the count and the indexed entries", async () => {
    const n = freezeListNetwork(FROZEN);
    expect(await fetchFreezeList(n)).toEqual(FROZEN);
    expect(n.calls).toEqual([
      `program/${FREEZELIST_PROGRAM}/mapping/freeze_list_count/1u8`,
      `program/${FREEZELIST_PROGRAM}/mapping/freeze_list/0u32`,
      `program/${FREEZELIST_PROGRAM}/mapping/freeze_list/1u32`,
    ]);
  });

  it("an empty or missing list is an empty tree, not an error", async () => {
    expect(await fetchFreezeList(freezeListNetwork([]))).toEqual([]);
    expect(await exclusionProofFor(SENDER, freezeListNetwork([]))).toMatch(PROOF_SHAPE);
  });

  it("passes a real network failure through", async () => {
    const n: RailNetwork = { fetchJson: async () => { throw new RailNetworkError("down", 503); } };
    await expect(fetchFreezeList(n)).rejects.toThrow(/down/);
  });
});
