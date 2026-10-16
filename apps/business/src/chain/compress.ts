// ---------------------------------------------------------------------------
// Smaller payloads for letters on chain: a document is deflated before it is
// sealed when that makes it smaller (English text shrinks to about a third),
// so a long offer still fits in one page (chain/letters.ts). The first byte
// says which: 0x01 then deflate-raw bytes, or the document as it is (a JSON
// document starts with `{`, so the two can't be confused). Uses the
// browser's own CompressionStream; nothing is logged.
// ---------------------------------------------------------------------------

const DEFLATED = 0x01;

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** The payload to seal: deflated with its marker when that's smaller, else the bytes as they are. */
export async function packPayload(bytes: Uint8Array): Promise<Uint8Array> {
  const deflated = await through(bytes, new CompressionStream("deflate-raw"));
  if (deflated.length + 1 >= bytes.length) return bytes;
  const out = new Uint8Array(deflated.length + 1);
  out[0] = DEFLATED;
  out.set(deflated, 1);
  return out;
}

/** The document back from a payload `packPayload` made (or from one that was never deflated). */
export async function unpackPayload(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== DEFLATED) return bytes;
  try {
    return await through(bytes.subarray(1), new DecompressionStream("deflate-raw"));
  } catch {
    throw new Error("The document couldn't be unpacked");
  }
}
