// ---------------------------------------------------------------------------
// Where an account stands in its setup. Every account, business or worker,
// links a Shield account and registers its name.hewn before it can use the
// app (Joshua, 2026-10-15); a worker also creates the private profile behind
// the name, as the MVP did; and, since the cards program went live
// (2026-10-25), every new account ends by issuing its card. The app shell
// sends an unfinished account to /settings/setup and keeps it there until
// this says "done".
//
// Pure: reads only what the vault already holds.
// ---------------------------------------------------------------------------

import { CARDS_SINCE } from "./card";
import type { Rail } from "./rail";
import type { CustomerSide } from "./customer";
import type { Role, Work } from "./work";

export type SetupStep = "link" | "name" | "profile" | "card" | "done";

export const SETUP_PATH = "/settings/setup";

export function setupStep({
  role,
  rail,
  work,
  customer,
}: {
  role: Role;
  rail: Rail | null | undefined;
  work: Work | null | undefined;
  customer?: CustomerSide | null;
}): SetupStep {
  if (!rail) return "link";
  // A customer has a name and nothing else on chain: no profile, and no card yet.
  if (role === "customer") return customer?.name ? "done" : "name";
  const card = cardStepApplies(rail);
  if (role === "worker") {
    if (!work?.profile) return "name";
    if (!work.profile.profileAnchored) return "profile";
    return card && !work.profile.card ? "card" : "done";
  }
  if (!rail.businessNameHash) return "name";
  return card && !rail.card ? "card" : "done";
}

/**
 * Whether setup ends with the card. An account linked before the cards program went live claims
 * its card from Settings instead: a step here would stop it at the door, and it may hold nothing
 * for the network fee. An account not linked yet is about to be, so it counts as new.
 */
export function cardStepApplies(rail: Pick<Rail, "linkedAt"> | null | undefined): boolean {
  return !rail || Date.parse(rail.linkedAt) >= Date.parse(CARDS_SINCE);
}

/** Every step a role can go through, in order. */
export const SETUP_STEPS: Record<Role, Exclude<SetupStep, "done">[]> = {
  business: ["link", "name", "card"],
  worker: ["link", "name", "profile", "card"],
  customer: ["link", "name"],
};

/** The steps this account goes through, for the progress list. */
export function setupSteps(role: Role, rail: Pick<Rail, "linkedAt"> | null | undefined): Exclude<SetupStep, "done">[] {
  return cardStepApplies(rail) ? SETUP_STEPS[role] : SETUP_STEPS[role].filter((s) => s !== "card");
}

/** Where an unfinished account must go instead of `pathname`, or null when it may stay. */
export function setupRedirect(step: SetupStep, pathname: string): string | null {
  if (step === "done") return null;
  return pathname === SETUP_PATH ? null : SETUP_PATH;
}
