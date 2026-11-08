// ---------------------------------------------------------------------------
// Saving a file from the books: the share sheet on a touch device that offers
// it (Shield's own browser can drop a plain download without a word,
// 2026-10-26), otherwise a download. Nothing is uploaded anywhere.
//
// The share sheet takes only some file types. Chrome-based browsers on Android
// (Brave among them) refuse a file typed `application/json` with "Permission
// denied", though `canShare` said yes (2026-11-08), and share the same bytes
// typed as plain text. So a shared file goes as `text/plain`, its name ending
// in `.txt` (`books-2026-11-08.hewn.txt`); its contents are unchanged, and
// the restore and proof pickers take `.txt`. A browser that still refuses gets
// the plain download, under the file's own name, rather than an error.
// ---------------------------------------------------------------------------

export type Saved = "shared" | "downloaded" | "cancelled";

/** The browser, as saveFile uses it; tests pass their own. */
export type SaveEnv = {
  touch: boolean;
  canShare: (file: File) => boolean;
  share: (file: File, title: string) => Promise<void>;
  download: (file: File) => void;
};

/** The name a file is shared under: its own, with `.txt` after it, so share sheets take it. */
export function sharedName(fileName: string): string {
  return fileName.toLowerCase().endsWith(".txt") ? fileName : `${fileName}.txt`;
}

/** What a failed share means: the person closed the sheet, or the browser refused the file (download it instead). */
export function shareFailure(e: unknown): "cancelled" | "download" | "throw" {
  const name = e instanceof Error || e instanceof DOMException ? e.name : "";
  if (name === "AbortError") return "cancelled";
  if (name === "NotAllowedError" || name === "DataError" || name === "TypeError") return "download";
  return "throw";
}

/** The file types the restore and proof pickers take: the file's own, and the `.txt` a share sheet saved. */
export function pickerAccept(extension: string, type = "application/json"): string {
  return `.${extension},${type},.txt,text/plain`;
}

export async function saveFile(text: string, fileName: string, type = "application/json", env: SaveEnv = browserEnv()): Promise<Saved> {
  if (env.touch) {
    const shared = new File([text], sharedName(fileName), { type: "text/plain" });
    if (env.canShare(shared)) {
      try {
        await env.share(shared, fileName);
        return "shared";
      } catch (e) {
        const failure = shareFailure(e);
        if (failure === "cancelled") return "cancelled";
        if (failure === "throw") throw e;
        // Refused by this browser: the plain download below.
      }
    }
  }
  env.download(new File([text], fileName, { type }));
  return "downloaded";
}

function browserEnv(): SaveEnv {
  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  return {
    touch: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches,
    canShare: (file) => Boolean(nav.canShare?.({ files: [file] })),
    share: (file, title) => nav.share({ files: [file], title }),
    download: (file) => {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
