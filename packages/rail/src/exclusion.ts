// ---------------------------------------------------------------------------
// The employer's proof that it is not on the stablecoin's freeze list.
//
// `transfer_private` takes a Merkle exclusion proof: two sibling paths (the
// leaves either side of where the sender's address would sit) over the
// freeze list, depth 16 to match the program's `MerkleProof` struct. The
// tree and the proof come from the SDK's `SealanceMerkleTree`, formatted the
// way the transition expects, exactly as the coordinator did before.
//
// The list comes from the freeze-list program's public mappings, as deployed:
// `freeze_list_last_index[true]` is the highest slot in use,
// `freeze_list_index[0u32..=last]` holds an address per slot (the zero
// address in a slot that was unfrozen, or never used), and
// `freeze_list_root[1u8]` is the root the network checks a proof against.
// The explorer answers null, not an error, for a mapping or key that doesn't
// exist, so a list that reads as nothing is not taken for an empty one: the
// root of what was read must be the chain's, or no proof is built and
// nothing is sent. A transfer with a proof over the wrong list is rejected
// on chain after its fee is spent; refusing here costs nothing.
//
// The proof depends only on the sender and the list, so one run builds it
// once and every transfer reuses it.
// ---------------------------------------------------------------------------

import { PROGRAMS } from "@pnw/config/programs";
import { SealanceMerkleTree } from "@provablehq/sdk";
import { isNotFound } from "./network";
import { RailError, type RailNetwork } from "./types";

/** Must match `siblings: [field; 16]` in the deployed stablecoin's MerkleProof struct. */
export const TREE_DEPTH = 16;

export const FREEZELIST_PROGRAM = PROGRAMS.external.usdcx_freezelist;

/** The address nobody holds a key for. The freeze list keeps it in every slot that holds no one. */
export const ZERO_ADDRESS = "aleo1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3ljyzc";

const UNREADABLE = "The stablecoin's freeze list couldn't be read, so nothing was sent. Try again in a minute";
const NOT_WHOLE = "What was read of the stablecoin's freeze list doesn't match the network's, so nothing was sent. Try again in a minute; if it keeps happening, pay in Shield and record it";
const SENDER_FROZEN = "This account is on the stablecoin's freeze list, so the network would refuse every payment from it; nothing was sent";

const ADDRESS = /^aleo1[a-z0-9]{58}$/;
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

/**
 * The frozen addresses, from `freeze_list_index[0u32..=freeze_list_last_index[true]]`, leaving out
 * the slots that hold the zero address. Throws when the last index or a slot isn't what the
 * program writes; whether everything was read is for the root to say (`exclusionProofFor`).
 */
export async function fetchFreezeList(network: RailNetwork): Promise<string[]> {
  const lastRaw = await readMapping(network, "freeze_list_last_index", "true");
  const last = lastRaw !== null && /^\d{1,6}u32$/.test(lastRaw) ? parseInt(lastRaw, 10) : NaN;
  // The tree has 2^16 leaves, so a higher index isn't this program's.
  if (!Number.isInteger(last) || last >= 2 ** TREE_DEPTH) throw new RailError(UNREADABLE);
  const addresses: string[] = [];
  for (let i = 0; i <= last; i++) {
    const slot = await readMapping(network, "freeze_list_index", `${i}u32`);
    if (slot === null) continue; // the root check says whether anything is missing
    if (!ADDRESS.test(slot)) throw new RailError(UNREADABLE);
    if (slot !== ZERO_ADDRESS) addresses.push(slot);
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

/** The root of the tree over `frozen`, written as the chain writes it (`<n>field`). */
export function freezeListRoot(frozen: readonly string[], tree: Pick<MerkleTreeApi, "generateLeaves" | "buildTree"> = new SealanceMerkleTree()): string {
  const merkle = tree.buildTree(tree.generateLeaves([...frozen], TREE_DEPTH));
  return `${merkle[merkle.length - 1]}field`;
}

/**
 * Fetches the list and builds the proof: one call per run, before anything is asked of the wallet.
 * Throws, so nothing is sent, when the list can't be read, when the root of what was read isn't
 * `freeze_list_root[1u8]`, or when the sender is on the list.
 */
export async function exclusionProofFor(sender: string, network: RailNetwork, tree?: MerkleTreeApi): Promise<string> {
  const frozen = await fetchFreezeList(network);
  const onChain = await readMapping(network, "freeze_list_root", "1u8");
  if (onChain === null || !/^\d+field$/.test(onChain)) throw new RailError(UNREADABLE);
  let root: string;
  try {
    root = freezeListRoot(frozen, tree);
  } catch {
    throw new RailError(UNREADABLE); // a slot held something the tree can't take as an address
  }
  if (root !== onChain) throw new RailError(NOT_WHOLE);
  if (frozen.includes(sender)) throw new RailError(SENDER_FROZEN);
  return buildExclusionProof(sender, frozen, tree);
}
