"use client";

// The wallet provider every chain panel mounts: @pnw/wallet's provider, plus the pairing screen a
// computer without the Shield extension needs (./ShieldPairing.tsx). One place, so no panel can
// start a connect on a computer and leave the person without the code to finish it.

import type { ReactNode } from "react";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { ShieldPairing } from "./ShieldPairing";

export function ShieldProvider({ children }: { children: ReactNode }) {
  return (
    <AleoWalletProviderWrapper>
      <ShieldPairing />
      {children}
    </AleoWalletProviderWrapper>
  );
}
