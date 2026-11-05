// ---------------------------------------------------------------------------
// Saving a file from the books: the share sheet on a touch device that offers
// it (Shield's own browser can drop a plain download without a word,
// 2026-10-26), otherwise a download. Nothing is uploaded anywhere.
// ---------------------------------------------------------------------------

export type Saved = "shared" | "downloaded" | "cancelled";

export async function saveFile(text: string, fileName: string, type = "application/json"): Promise<Saved> {
  const file = new File([text], fileName, { type });
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (touch && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      throw e;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
