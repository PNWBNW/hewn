"use client";

// Profile: the person's registered name and whether the profile is done,
// from the vault; the registry-backed steps load only when tapped.

import { useState } from "react";
import dynamic from "next/dynamic";
import { CircleCheck, Circle } from "lucide-react";
import { Button } from "@pnw/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@pnw/ui/card";
import { cn } from "@pnw/ui/utils";
import { useWork } from "@/books/BooksProvider";
import { CREDENTIAL_KIND_LABEL, CREDENTIAL_STATUS_LABEL, credentialSpan } from "@/books/credential";
import { shortAddress } from "@/books/rail";
import { BRAND } from "@/brand";
import { PageHeader } from "@/shell/SectionView";
import { RailNeeded, when } from "../shared";

const ProfilePanel = dynamic(() => import("@/chain/work/Profile"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});
const CredentialsPanel = dynamic(() => import("@/chain/work/Credentials"), {
  ssr: false,
  loading: () => <p className="text-sm text-muted-foreground">Loading…</p>,
});

export default function ProfilePage() {
  const { work, rail } = useWork();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const profile = work.profile;
  const credentials = work.credentials ?? [];
  const employerLabel = (address: string) => {
    const name = work.agreements.find((a) => a.employerAddress === address && a.employerName)?.employerName;
    return name ? `${name}.${BRAND.nameSuffix}` : shortAddress(address);
  };
  const done = !!profile?.profileAnchored;
  const steps = [
    { label: "Register your name", done: !!profile },
    { label: "Create your profile", done },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Profile" summary="The name employers know you by, and the profile behind it." />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{profile ? `${profile.name}.${BRAND.nameSuffix}` : "No name registered yet"}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {done
              ? `Profile complete. Registered ${when(profile!.registeredAt)}.`
              : profile
                ? "Your name is registered. Create your profile so employers can send you offers."
                : "Register a name on the registry, then create your profile. Both are one-time steps."}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="divide-y">
            {steps.map((s) => {
              const Icon = s.done ? CircleCheck : Circle;
              return (
                <li key={s.label} className="flex min-h-11 items-center gap-3 py-2 text-sm">
                  <Icon aria-hidden className={cn("size-4 shrink-0", s.done ? "text-money-positive" : "text-muted-foreground")} />
                  <span className={cn(s.done && "text-muted-foreground line-through")}>{s.label}</span>
                  <span className="sr-only">{s.done ? "Done" : "Not done"}</span>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-muted-foreground">You are known as {work.displayName} on this device. Only the registered name is shared.</p>
          {!rail ? (
            <RailNeeded />
          ) : open ? (
            <ProfilePanel onClose={() => setOpen(false)} />
          ) : (
            <Button className="min-h-11 self-start sm:min-h-9" onClick={() => setOpen(true)}>
              {done ? "Check the registry" : profile ? "Create profile" : "Set up my name"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Credentials</CardTitle>
          <p className="text-sm text-muted-foreground">
            What businesses you work for vouch for: a job, a skill, a clearance. Each one you accept stands as a landmark on your land, in Settings. Nobody else sees them.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {credentials.length > 0 && (
            <ul className="divide-y text-sm">
              {credentials.map((c) => (
                <li key={c.commitment} className="flex flex-col py-2">
                  <span className="font-medium">{c.document.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {employerLabel(c.counterpart)} · {CREDENTIAL_KIND_LABEL[c.kind]} · {credentialSpan(c.document)} · {CREDENTIAL_STATUS_LABEL[c.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!rail ? (
            <RailNeeded />
          ) : checking ? (
            <CredentialsPanel onClose={() => setChecking(false)} />
          ) : (
            <Button variant={credentials.length > 0 ? "outline" : "default"} className="min-h-11 self-start sm:min-h-9" onClick={() => setChecking(true)}>
              Check for credentials
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
