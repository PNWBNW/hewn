"use client";

// The wallet provider every chain panel mounts: @pnw/wallet's provider, plus the pairing screen a
// computer without the Shield extension needs (./ShieldPairing.tsx). One place, so no panel can
// start a connect on a computer and leave the person without the code to finish it.

import { type ReactNode, useState } from "react";
import { forgetUnfinishedPairing } from "@pnw/wallet/desktop-pairing";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { ShieldPairing } from "./ShieldPairing";
import { isPhone } from "./shield_route";

type SessionStore = Parameters<typeof forgetUnfinishedPairing>[0];

/**
 * Forgets, once per page load and only on a computer, a pairing an earlier visit started and never
 * finished (`forgetUnfinishedPairing`): otherwise the adapter would resume it with the same secret,
 * and a code photographed then would pair now; the choice of Shield goes too, so no panel starts a
 * new pairing until the person asks. Once, so panels opened later in the same visit still share the
 * pairing this visit started; never on a phone, which returns from Shield by reloading.
 */
export function earlierPairingForgetter(): (phone: boolean, storage: () => SessionStore) => void {
  let done = false;
  return (phone, storage) => {
    if (done) return;
    done = true;
    if (!phone) forgetUnfinishedPairing(storage());
  };
}

const forgetEarlierPairing = earlierPairingForgetter();

function pageStorage(): SessionStore {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // storage blocked
  }
}

export function ShieldProvider({ children }: { children: ReactNode }) {
  // Before the provider below can auto-connect: a lazy initial state runs in this first render.
  useState(() => {
    if (typeof window !== "undefined") forgetEarlierPairing(isPhone(), pageStorage);
    return true;
  });
  return (
    <AleoWalletProviderWrapper>
      <ShieldPairing />
      {children}
    </AleoWalletProviderWrapper>
  );
}
