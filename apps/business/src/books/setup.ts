// ---------------------------------------------------------------------------
// Where an account stands in its setup. Every account, business or worker,
// links a Shield account and registers its name.hewn before it can use the
// app (Joshua, 2026-10-15); a worker also creates the private profile behind
// the name, as the MVP did. The app shell sends an unfinished account to
// /settings/setup and keeps it there until this says "done".
//
// Pure: reads only what the vault already holds.
// ---------------------------------------------------------------------------

import type { Rail } from "./rail";
import type { Role, Work } from "./work";

export type SetupStep = "link" | "name" | "profile" | "done";

export const SETUP_PATH = "/settings/setup";

export function setupStep({ role, rail, work }: { role: Role; rail: Rail | null | undefined; work: Work | null | undefined }): SetupStep {
  if (!rail) return "link";
  if (role === "worker") {
    if (!work?.profile) return "name";
    return work.profile.profileAnchored ? "done" : "profile";
  }
  return rail.businessNameHash ? "done" : "name";
}

/** The steps a role goes through, in order, for the progress list. */
export const SETUP_STEPS: Record<Role, Exclude<SetupStep, "done">[]> = {
  business: ["link", "name"],
  worker: ["link", "name", "profile"],
};

/** Where an unfinished account must go instead of `pathname`, or null when it may stay. */
export function setupRedirect(step: SetupStep, pathname: string): string | null {
  if (step === "done") return null;
  return pathname === SETUP_PATH ? null : SETUP_PATH;
}
