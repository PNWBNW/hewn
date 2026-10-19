import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BRAND } from "@pnw/brand";

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${BRAND.name} keeps on your device, what it never sends, and the one thing a server ever sees.`,
  alternates: { canonical: "/privacy" },
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

const p = "text-base leading-7 text-muted-foreground";
const list = "list-disc space-y-1.5 pl-5 text-base leading-7 text-muted-foreground";

export default function Privacy() {
  return (
    <article className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className={`mt-3 ${p}`}>
        {BRAND.name} is built so that there is nothing to collect. This page says plainly what stays
        on your device, what never leaves it, and the one thing a server ever sees. It is a description
        of how the software works, not a legal contract.
      </p>

      <div className="mt-10 space-y-10">
        <Block title="What never leaves your device">
          <ul className={list}>
            <li>Your books: every account, entry, customer, vendor, invoice, bill and project.</li>
            <li>Your team's details: names, pay, withholding, tax forms and paystubs.</li>
            <li>Your passphrase. It is never stored anywhere, not even on your own device.</li>
          </ul>
          <p className={p}>
            All of it lives in an encrypted vault inside your browser. The key that opens the vault
            is derived from your passphrase in memory when you unlock, and dropped again when you
            lock, reload or walk away for fifteen minutes. A backup is that same encrypted vault
            saved as a file; it can only be opened with your passphrase.
          </p>
        </Block>

        <Block title="No account, no server, no database">
          <p className={p}>
            You do not sign up. The website and the app are served as code and nothing else: there
            is no database behind them and no interface through which your books could be read or
            written. If our host were breached, there would be no books on it to take.
          </p>
        </Block>

        <Block title="Page counts, no tracking, no cookies, no third parties">
          <ul className={list}>
            <li>
              While {BRAND.name} is on testnet, we count page views in aggregate, to see how many people
              are trying it and which pages they read. The count is the page's address with nothing after
              it, the site that linked you here, and your rough country, browser and device type. It uses
              no cookies and nothing that identifies you, and it never sees anything inside the app: your
              books, names, amounts and messages stay on your device. We may turn it off when{" "}
              {BRAND.name} moves to mainnet.
            </li>
            <li>
              For the public map of where {BRAND.name} is used, we also keep two running totals per
              country: visits and visitors since launch. No dates, no addresses, nothing per person. Your
              device remembers it has been counted and sends only yes or no. A country appears on the map
              only once it has five visitors.
            </li>
            <li>No tracking across sites, no advertising, no profiles. We do not know who you are.</li>
            <li>No cookies.</li>
            <li>No third-party scripts, fonts or embeds. Every page is served from our own address.</li>
            <li>
              Each page tells your browser, through its security policy, that it may only talk to the
              address it came from. The app adds two exceptions: a public, read-only lookup of the
              payment network, used only if you choose private payments and only when you start a
              lookup yourself; and, on a phone, Shield&apos;s own relay, which carries sealed messages
              between the app and Shield and can read none of them.
            </li>
          </ul>
        </Block>

        <Block title="The one thing a server ever sees">
          <p className={p}>
            When you share a document with someone you work with (an offer, a tax form, a paystub,
            a payment note), the app seals it on your device and passes it through a small courier
            function on our host, so the other person can pick it up without email or a third
            party reading it. That function stores nothing and has no database.
          </p>
          <p className={p}>
            What it can see: the sealed package, a lookup code only the two of you can compute, and the
            usual time, size and network address of a request. What it cannot see: who either of you
            is, what kind of document it is, how many you have exchanged, or anything inside. The
            sealed copy is held only while it waits to be picked up, and both of you keep your own copy
            in your vaults.
          </p>
        </Block>

        <Block title="Private payments, if you turn them on">
          <p className={p}>
            Paying your team straight from the app is optional and off by default. When it is on,
            payments travel over a public payment network, but the public record holds only
            fingerprints: never an amount, a name, a note or who was paid. Those stay in the private
            records of the sender and the receiver.
          </p>
        </Block>

        <Block title="What this means for you">
          <ul className={list}>
            <li>Nobody can hand over your books, because nobody has them.</li>
            <li>
              A forgotten passphrase means books that cannot be recovered. Keep an encrypted backup and
              keep your passphrase somewhere safe.
            </li>
            <li>
              Software on your own device that can read your screen can read what you see. Keep your
              computer and browser updated.
            </li>
          </ul>
        </Block>

        <p className="text-sm text-muted-foreground">
          The full threat model behind this page is kept with the source code as{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">docs/THREAT_MODEL.md</code>.
          Last reviewed 19 October 2026.
        </p>
      </div>
    </article>
  );
}
