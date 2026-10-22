// The terms of use (Joshua, 2026-10-22): plain words, public, read with or without an account.
// Washington State law; the operator, the support address and the source live in packages/brand.

import Link from "next/link";
import { BRAND } from "@/brand";
import { LEGAL_UPDATED, LegalPage } from "./LegalPage";

const mail = <a href={`mailto:${BRAND.supportEmail}`} className="underline underline-offset-4">{BRAND.supportEmail}</a>;

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      summary={`${BRAND.name} is run by ${BRAND.operator}. "We" below means ${BRAND.name} and the person who runs it.`}
      updated={LEGAL_UPDATED}
      sections={[
        {
          heading: `What ${BRAND.name} is`,
          body: (
            <p>
              {BRAND.name} is free, open-source bookkeeping and payroll software, running on the Aleo testnet. It is a test release: features change, and the
              testnet itself can be reset, which would erase anything stored on it (registered names, letters, job posts). Your books live on your own device
              and aren&apos;t affected by a reset.
            </p>
          ),
        },
        {
          heading: "No real money",
          body: <p>On testnet, ALEO and USDCx have no value. Nothing in {BRAND.name} moves real funds.</p>,
        },
        {
          heading: "Provided as is",
          body: (
            <>
              <p>
                {BRAND.name} is provided <strong>&quot;as is&quot;, without warranty of any kind</strong>, as its licence (AGPL-3.0) says. Tax and payroll
                figures are calculated by software and may be wrong.
              </p>
              <p>
                <strong>{BRAND.name} is not tax, legal, accounting or financial advice.</strong> Check figures with a professional before you rely on them.
                You are responsible for your own filings and payments.
              </p>
            </>
          ),
        },
        {
          heading: "Your account and your data",
          body: (
            <p>
              Your books are encrypted on your device with your username and passphrase. Nobody else, including us, can open them or recover a lost
              passphrase. Keep a backup file somewhere safe.
            </p>
          ),
        },
        {
          heading: "Your wallet",
          body: <p>Everything that goes on chain is approved by you in Shield, your own wallet. We never hold your keys or your funds.</p>,
        },
        {
          heading: "Use it fairly",
          body: (
            <p>
              Don&apos;t use {BRAND.name} to harass people, send scams, or break the law. Messages can be reported, and we may act on reports.
            </p>
          ),
        },
        {
          heading: "Liability",
          body: <p>To the extent the law allows, we aren&apos;t liable for losses from using {BRAND.name}, including wrong figures, lost data or a testnet reset.</p>,
        },
        {
          heading: "The code",
          body: (
            <p>
              {BRAND.name}&apos;s source is at{" "}
              <a href={BRAND.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                {BRAND.sourceUrl.replace(/^https:\/\//, "")}
              </a>{" "}
              under the AGPL-3.0 licence. The {BRAND.name} name and logo aren&apos;t part of that licence.
            </p>
          ),
        },
        {
          heading: "Law",
          body: <p>These terms are governed by the laws of the State of Washington, USA.</p>,
        },
        {
          heading: "Changes and contact",
          body: (
            <p>
              We may update these terms; the date below shows the latest. How we handle data is on the{" "}
              <Link href="/privacy" className="underline underline-offset-4">
                privacy page
              </Link>
              . Questions: {mail}.
            </p>
          ),
        },
      ]}
    />
  );
}
