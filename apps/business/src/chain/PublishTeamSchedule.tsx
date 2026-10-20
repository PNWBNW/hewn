"use client";

// ---------------------------------------------------------------------------
// Publishing a week to the whole team (books/team_schedule.ts): everyone's
// shifts and on-call days, posted in the business's "Team schedule"
// announcement channel so everyone who works here sees the same calendar.
//
//   1. The channel: made the first time, with everyone linked on the team
//      (each gets its key in their own conversation: a letter each, once);
//      after that, people who joined get the key and people who left are
//      taken out (the channel moves to a new key the rest get).
//   2. The week: one post per part (a big team takes several), each one
//      letter to everyone, one Shield approval for each eight people.
//
// Each person then confirms their own days from their Schedule page. Nothing
// here logs a key, a name or a time.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Button } from "@pnw/ui/button";
import { type FeeMode, readFeeMode } from "@pnw/wallet/fee-mode";
import { AleoWalletProviderWrapper } from "@pnw/wallet/wallet-provider";
import { FormError, errorMessage } from "@/books/AuthCard";
import { useOpenBooks } from "@/books/BooksProvider";
import { type BusinessChannel, addMembers, addOwnPost, newChannel, removeMembers } from "@/books/channels";
import type { Company } from "@/books/company";
import { type Mailbox, emptyMailbox, putChannel, threadFor, updateThread } from "@/books/mailbox";
import { emptySchedule, emptyWeek, setDraft } from "@/books/schedule";
import { type TeamEntry, type TeamPerson, whoOf } from "@/books/team_schedule";
import { addToThread, newMessageId } from "@/books/thread";
import { shortAddress } from "@/books/rail";
import { FeeChoice } from "./FeeChoice";
import { ShieldStatus } from "./ShieldStatus";
import { type KeyOutResult, type Member, postToChannel, sendChannelKey } from "./channels";
import { useLetters } from "./letter_reader";
import { LetterBox, MANY, ManyLetterBox } from "./letters";
import { partText, teamParts } from "./team_publish";

export const TEAM_CHANNEL_NAME = "Team schedule";

export type PublishTeamScheduleProps = {
  weekStart: string;
  weekLabel: string;
  /** Everyone with days this week who can be reached. */
  people: TeamEntry[];
  onClose: (sent: boolean) => void;
};

export default function PublishTeamSchedule(props: PublishTeamScheduleProps) {
  return (
    <AleoWalletProviderWrapper>
      <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-3">
        <PublishFlow {...props} />
      </div>
    </AleoWalletProviderWrapper>
  );
}

const keepSent = (m: Mailbox, sent: KeyOutResult["sent"]): Mailbox => sent.reduce((acc, s) => updateThread(acc, s.partiesKey, s.workerId, (t) => addToThread(t, s.item)), m);

function PublishFlow({ weekStart, weekLabel, people, onClose }: PublishTeamScheduleProps) {
  const { rail, payroll, mailbox, schedule, updateCompany } = useOpenBooks();
  const { state, route, connect, error: shieldError, address, mismatch, letters, wallet } = useLetters();
  const [feeMode, setFeeMode] = useState<FeeMode>(() => readFeeMode());
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Everyone who works here and can be reached: they all get the calendar, scheduled this week or not.
  const active = new Set(payroll.workers.filter((w) => w.active).map((w) => w.id));
  const team = (rail?.links ?? []).filter((l) => l.status === "linked" && l.partiesKey && active.has(l.workerId));
  const byId = new Map(team.map((l) => [l.workerId, l]));
  const channel = schedule?.channelId ? mailbox?.channels?.find((c) => c.id === schedule.channelId) : undefined;
  const added = channel ? team.filter((l) => !channel.members.includes(l.workerId)).map((l) => l.workerId) : team.map((l) => l.workerId);
  const gone = channel ? channel.members.filter((m) => !byId.has(m)) : [];
  const keyLetters = channel ? (gone.length > 0 ? channel.members.length : 0) + added.length : team.length;
  const postApprovals = Math.ceil(Math.max(1, team.length) / MANY);

  if (team.length === 0) return <FormError message="Nobody on the team has accepted an offer yet, so there's no one to publish to." />;
  if (mismatch && address) {
    return (
      <>
        <p className="text-sm">
          Shield is signed in to a different account ({shortAddress(address)}) than the one linked to these books. Switch accounts in Shield, then try again.
        </p>
        <Button variant="outline" className="min-h-11 self-start sm:min-h-9" onClick={() => onClose(false)}>
          Close
        </Button>
      </>
    );
  }
  if (!letters || !address) {
    return (
      <>
        <ShieldStatus state={state} route={route} connect={connect} onClose={() => onClose(false)} />
        {shieldError && <p className="text-sm text-destructive">{shieldError}</p>}
      </>
    );
  }

  const memberOf = (workerId: string, m: Mailbox | null | undefined): Member => {
    const l = byId.get(workerId)!;
    return { workerId, partiesKey: l.partiesKey!, address: l.address, thread: threadFor(m, l.partiesKey!) };
  };
  const keyClient = (m: Member) => new LetterBox({ wallet, to: m.address! });
  const save = (change: (c: Company) => Company) => updateCompany(change);

  async function publish() {
    setError(null);
    try {
      // 1. The channel, with everyone on the team in it.
      let ch: BusinessChannel;
      let current: Mailbox | null | undefined = mailbox;
      const failed: string[] = [];
      if (!channel) {
        setStage("Giving everyone the calendar's key: approve one letter each in Shield…");
        ch = newChannel(TEAM_CHANNEL_NAME, team.map((l) => l.workerId));
        const out = await sendChannelKey(keyClient, ch, ch.members.map((id) => memberOf(id, current)), false, feeMode);
        failed.push(...out.failed.map((f) => f.workerId));
        const made = ch;
        const next = await save((c) => ({
          ...c,
          mailbox: putChannel(keepSent(c.mailbox ?? emptyMailbox(), out.sent), made),
          schedule: { ...(c.schedule ?? emptySchedule()), channelId: made.id },
        }));
        current = next.mailbox;
      } else {
        ch = channel;
        let sent: KeyOutResult["sent"] = [];
        if (gone.length > 0) {
          setStage("Taking out people who've left: approve a new key for everyone who stays…");
          ch = removeMembers(ch, gone);
          const stay = await sendChannelKey(keyClient, ch, ch.members.filter((m) => byId.has(m)).map((id) => memberOf(id, current)), false, feeMode);
          sent = [...sent, ...stay.sent];
          failed.push(...stay.failed.map((f) => f.workerId));
        }
        if (added.length > 0) {
          setStage("Giving the calendar's key to new people: approve one letter each…");
          ch = addMembers(ch, added);
          const out = await sendChannelKey(keyClient, ch, added.map((id) => memberOf(id, current)), false, feeMode);
          sent = [...sent, ...out.sent];
          failed.push(...out.failed.map((f) => f.workerId));
        }
        if (ch !== channel) {
          const changed = ch;
          const next = await save((c) => ({ ...c, mailbox: putChannel(keepSent(c.mailbox ?? emptyMailbox(), sent), changed) }));
          current = next.mailbox;
        }
      }

      // 2. The week, in as many posts as it takes, each to everyone in the channel.
      const roster: TeamPerson[] = people.map((p) => ({ who: whoOf(p.partiesKey), name: p.name, days: p.days }));
      const parts = await teamParts(weekStart, weekLabel, roster, newMessageId());
      const to = ch.members.flatMap((id) => (byId.has(id) ? [byId.get(id)!.address] : []));
      for (const part of parts) {
        setStage(parts.length > 1 ? `Publishing part ${part.part + 1} of ${parts.length}: approve it in Shield…` : "Publishing the week: approve it in Shield…");
        const latest = current?.channels?.find((x) => x.id === ch.id) ?? ch;
        const item = await postToChannel(new ManyLetterBox({ wallet, to, self: address! }), latest, partText(weekLabel, part.part, part.parts), new Date(), feeMode, { schedule: part });
        const next = await save((c) => {
          const now = c.mailbox?.channels?.find((x) => x.id === ch.id) ?? latest;
          return { ...c, mailbox: putChannel(c.mailbox ?? emptyMailbox(), addOwnPost(now, item)) };
        });
        current = next.mailbox;
      }
      // Published: the drafts of the people on it have done their job.
      await save((c) => ({ ...c, schedule: people.reduce((s, p) => setDraft(s, p.workerId, emptyWeek(weekStart)), c.schedule ?? emptySchedule()) }));
      if (failed.length > 0) {
        const names = new Map(payroll.workers.map((w) => [w.id, w.name]));
        setError(`Published. Couldn't give the key to ${failed.map((id) => names.get(id) ?? "someone").join(", ")}; publish again to retry them.`);
        setStage(null);
        return;
      }
      onClose(true);
    } catch (e) {
      setError(errorMessage(e));
      setStage(null);
    }
  }

  return (
    <>
      <p className="text-sm">
        Publish the week of {weekLabel} to everyone on the team ({team.length} {team.length === 1 ? "person" : "people"}). They all see the same calendar, and each
        confirms their own days.
      </p>
      <p className="text-xs text-muted-foreground">
        {keyLetters > 0 && `First, ${keyLetters} ${keyLetters === 1 ? "letter gives" : "letters give"} people the calendar's key (one Shield approval each). `}
        The week itself is about {postApprovals} {postApprovals === 1 ? "approval" : "approvals"} (one for each eight people), sealed so only the team can read it.
      </p>
      {stage ? <p className="text-sm text-muted-foreground">{stage}</p> : <FeeChoice value={feeMode} onChange={setFeeMode} />}
      <FormError message={error} />
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11 sm:min-h-9" disabled={stage !== null} onClick={() => void publish()}>
          {stage ? "Publishing…" : "Publish to the team"}
        </Button>
        <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={stage !== null} onClick={() => onClose(false)}>
          {error?.startsWith("Published") ? "Done" : "Cancel"}
        </Button>
      </div>
    </>
  );
}
