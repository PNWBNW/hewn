// ---------------------------------------------------------------------------
// The employer's proof that it is not on the stablecoin's freeze list.
//
// `transfer_private` takes a Merkle exclusion proof: two sibling paths (the
// leaves either side of where the sender's address would sit) over the
// freeze list, depth 16 to match the program's `MerkleProof` struct. The
// list comes from the freeze-list program's public mappings; the tree and
// the proof come from the SDK's `SealanceMerkleTree`, formatted the way the
// transition expects, exactly as the coordinator did before.
//
// The proof depends only on the sender and the list, so one run builds it
// once and every transfer reuses it.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";
import { SealanceMerkleTree } from "@provablehq/sdk";
import { isNotFound } from "./network";
import type { RailNetwork } from "./types";

/** Must match `siblings: [field; 16]` in the deployed stablecoin's MerkleProof struct. */
export const TREE_DEPTH = 16;

export const FREEZELIST_PROGRAM = PROGRAMS.external.usdcx_freezelist;

const stripQuotes = (v: unknown): string => (typeof v === "string" ? v.replace(/"/g, "").trim() : "");

/** Reads one mapping value, treating a missing key as absent rather than an error. */
async function readMapping(network: RailNetwork, mapping: string, key: string): Promise<string | null> {
  try {
    const value = await network.fetchJson(`program/${FREEZELIST_PROGRAM}/mapping/${mapping}/${key}`);
    return value === null || value === undefined ? null : stripQuotes(value);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** The frozen addresses, from `freeze_list_count[1u8]` and `freeze_list[iu32]`. */
export async function fetchFreezeList(network: RailNetwork): Promise<string[]> {
  const countRaw = await readMapping(network, "freeze_list_count", "1u8");
  const count = countRaw ? parseInt(countRaw.replace(/u\d+$/, ""), 10) : 0;
  if (!count || Number.isNaN(count)) return [];
  const addresses: string[] = [];
  for (let i = 0; i < count; i++) {
    const addr = await readMapping(network, "freeze_list", `${i}u32`);
    if (addr && addr.startsWith("aleo1")) addresses.push(addr);
  }
  return addresses;
}

/** The subset of the SDK tree the proof needs; injectable so the formatting is testable without WASM. */
export type MerkleTreeApi = Pick<SealanceMerkleTree, "generateLeaves" | "buildTree" | "getLeafIndices" | "getSiblingPath" | "formatMerkleProof">;

/** Formats the exclusion proof for `sender` over `frozen`, as a transition input string. */
export function buildExclusionProof(sender: string, frozen: readonly string[], tree: MerkleTreeApi = new SealanceMerkleTree()): string {
  const leaves = tree.generateLeaves([...frozen], TREE_DEPTH);
  const merkle = tree.buildTree(leaves);
  const [leftIdx, rightIdx] = tree.getLeafIndices(merkle, sender);
  const left = tree.getSiblingPath(merkle, leftIdx, TREE_DEPTH);
  const right = tree.getSiblingPath(merkle, rightIdx, TREE_DEPTH);
  return tree.formatMerkleProof([left, right]);
}

/** Fetches the list and builds the proof: one call per run. */
export async function exclusionProofFor(sender: string, network: RailNetwork, tree?: MerkleTreeApi): Promise<string> {
  return buildExclusionProof(sender, await fetchFreezeList(network), tree);
}
