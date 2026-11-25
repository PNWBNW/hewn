// Privacy (Joshua, 2026-10-22): what this app keeps, and where, in plain words. Public. It has to
// stay true to the code: the vault (packages/vault), the traction counts (app/api/traction), the
// page views (shell/PageViews.tsx), letters on chain (chain/letters.ts), reports (chain/report.ts).

import Link from "next/link";
import { BRAND } from "@/brand";
import { LEGAL_UPDATED, LegalPage } from "./LegalPage";

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      summary={`The short version: we don't collect your data. Your books never leave your device unencrypted, and there's no account on our side.`}
      updated={LEGAL_UPDATED}
      sections={[
        {
          heading: "On your device",
          body: (
            <p>
              Your books, payroll, schedule and messages are encrypted in your browser with a key only your passphrase unlocks. We can&apos;t read them, and
              there is no copy on any server.
            </p>
          ),
        },
        {
          heading: "On our servers",
          body: (
            <>
              <p>The site is hosted on Vercel. All it keeps is:</p>
              <ul className="list-disc pl-5">
                <li>
                  <strong>Page views</strong>, counted in aggregate by Vercel Web Analytics: no cookies, nothing that identifies you, and only the page&apos;s
                  path is sent.
                </li>
                <li>
                  <strong>Traction counts</strong>: two totals per country (visits and visitors) in a small store, with no dates, no addresses and no IDs. They
                  are shown on the{" "}
                  <Link href="/traction" className="underline underline-offset-4">
                    traction map
                  </Link>{" "}
                  only for countries with 5 or more visitors.
                </li>
              </ul>
              <p>
                Like any website, our host sees connection details (such as your IP address) when your browser loads a page. We don&apos;t store them or use
                them to identify you.
              </p>
            </>
          ),
        },
        {
          heading: "On the Aleo blockchain",
          body: (
            <>
              <p>
                Messages, offers, schedules and paystubs travel as private records that only the person they&apos;re for can open, sent from your own
                wallet. No server holds them.
              </p>
              <p>
                Some things are public by design: your registered name, job board posts, and the fact that a transaction happened. If you pay a network fee
                publicly, that shows your wallet address.
              </p>
            </>
          ),
        },
        {
          heading: "Other services your browser talks to",
          body: (
            <p>
              Shield (your wallet, and its relay if you use a phone browser) and Provable&apos;s explorer, to read the chain. They have their own privacy
              policies.
            </p>
          ),
        },
        {
          heading: "Reports",
          body: (
            <p>
              If you report a message, it goes to {BRAND.name}&apos;s own account as a sealed letter, and to our email only if you send it there. Please use
              reports only for genuine problems.
            </p>
          ),
        },
        {
          heading: "Contact",
          body: (
            <p>
              Questions:{" "}
              <a href={`mailto:${BRAND.supportEmail}`} className="underline underline-offset-4">
                {BRAND.supportEmail}
              </a>
              . The terms are on the{" "}
              <Link href="/terms" className="underline underline-offset-4">
                terms page
              </Link>
              .
            </p>
          ),
        },
      ]}
    />
  );
}
