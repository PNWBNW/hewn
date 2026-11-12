---
status: built
updated: 2026-11-11
summary: The sleep cycle for the agents that build Hewn, after Google's sleep framework for continual learning: consolidate before the fast store is wiped, at three rhythms (every compaction, nightly, weekly), and a monthly REM pass that practises and keeps only what finds something; as hooks and skills a plugin can carry to any repository. Extends docs/MEMORY.md. Built except the plugin (step 5), and the first REM run by hand.
---

# Sleep: consolidation at every rhythm, and a REM pass

**Status:** built (Joshua, 2026-11-07) through step 4 of the order at the end, one pull request each; the plugin (step 5) and the first REM run by hand remain.
It extends `docs/MEMORY.md`, which stands: the three scopes, the format, progressive reading,
signed writing, and the weekly dream. This document adds what that design lacked, read from
Google Research's sleep framework for continual learning (Behrouz and Mirrokni, 2026-10-27, and the
paper behind it, Behrouz, Hashemi, Javanmard and Mirrokni, arXiv 2606.03979; sources at the end).

## What the paper says, in our words

A model's life is a cycle of two states. In the **wake** phase it takes in input and holds it in
fast, short-term memory; in the **sleep** phase it takes no input and works on what it already
holds. Sleep has two stages:

1. **Consolidation** (the slow-wave stage). Memory is a ladder of stores that update at different
   speeds: the context window changes every token and is wiped at the end of a session, the
   model's weights never change, and the stores between them each have their own period. The
   rule that matters: *before a fast store is overwritten, what it holds is moved into a slower
   one*, and the move is an abstraction, not a copy ("memory consolidation should not simply
   replay raw data; it needs to explore and extract abstractions"). Old knowledge is frozen; the
   new goes into added capacity, so nothing is overwritten. Then the fast store is cleared
   ("synaptic pruning") to make room. Consolidation is iterative, from each store into the next
   slower one, and it is triggered by the fast store's period, not by a calendar.
2. **Dreaming** (the REM stage). The model generates its own practice material, deliberately
   mixing unrelated areas, keeps only the samples that measurably improve it on a real task, and
   discards the rest: mix, select by effect, discard most of it.

The mechanics (mixture-of-experts blocks, low-rank experts, on-policy distillation, a reward on
imitation) are a training recipe and don't transfer to a team of agents working in git. The
principles do, and the three below are the ones Hewn was missing.

## Where Hewn already matched

- **The ladder exists.** Working memory (a session's context) → `progress/` (one file a day) →
  `memory/` (the ledger and the lessons, curated weekly) → `CLAUDE.md` and the rules (changed only
  by a pull request about them). Slower is more trusted.
- **Freeze the old, add the new.** The dream never rewords a rule or changes its id; it appends.
  A superseding decision sits beside the one it supersedes.
- **Consolidate before the store is wiped, at session end.** The end-of-task progress entry
  (`CLAUDE.md`, Working agreement) does exactly that, and signs itself with the session id.

What Hewn called "dreaming" is the paper's *consolidation*. The paper's *dreaming* is the REM
pass below, which Hewn didn't have.

## What this adds

### 1. Consolidate before compaction, not only at the end

A session's context is compacted mid-task, by the harness, when it fills. That is the paper's
failure case: the fast store overwritten before its knowledge is moved. It bit a session on
2026-11-07 (a worktree moved back to an old commit by a leftover line; the state that would have
caught it was in the part of the context that was summarised away).

Claude Code's hooks make the fix mechanical, verified against its documentation on 2026-11-07:

- A **`PreCompact` hook** runs before the summary is made. Its standard output becomes the
  *instructions for the summary* (under 10,000 characters); a non-zero exit of 2 blocks the
  compaction. The hook is a script, so it also snapshots the **mechanical state** nobody has to
  remember: the branch and its dirty files, the open pull requests, the task list, the last
  progress entry, the scratchpad's note files.
- A **`SessionStart` hook with the `compact` matcher** runs right after the summary and can add
  text to the model's context (`additionalContext`). It reads the snapshot back. The same hook,
  on `startup` and `resume`, carries the session-start routine of `CLAUDE.md`.
- **`SessionEnd`** can only run side effects (1.5 seconds by default), and **`Stop`** fires after
  every reply; neither is needed for this.

So the cycle is the paper's "compute, consolidate, then apply": the state is written down, the
summariser is told what to keep (decisions pending with Joshua, work mid-flight, lessons learned,
the exact paths and commands in use; not the chatter), and only then is the context replaced.

What a hook prints is read by the model as its own notes, and a pass that runs unattended reads
whatever is in front of it. So two things hold since 2026-11-11. The hooks run the copy of the
snapshot script on `origin/main`, not the working tree's, and the snapshot names commits by short
id and the log by path and count: no commit title or entry heading, which anyone with a branch
can write, reaches the model that way. And the light sleep and the dream recognise their own
pull request by who opened it and where its branch lives, never by its title, and read no other
pull request's title or body (`.claude/skills/README.md`).

Two limits, from the same documentation. Hooks checked into the repository apply in a cloud
session **with one repository attached** (and in local sessions); a cloud session with several
repositories, like the one that wrote this, doesn't run them, and does the consolidation note by
hand. And Claude Code's own "auto memory" is machine-local and never reaches a cloud session,
which is why Hewn's memory lives in the repository and not there.

### 2. The missing slow rung, with pruning

The weekly dream moves what the week decided and learned from `progress/` into `memory/`, and
nothing moves from `memory/` into the rules. The paper's ladder says that is one rung short, and
that a store which only fills is a store that is never pruned:

- **Promotion.** A lesson that keeps proving true, or a decision every session now relies on,
  belongs in a README, `docs/INVARIANTS.md` or `CLAUDE.md`. The dream names the candidates, as
  questions in its pull request; a rule still changes only in a pull request about the rule
  (`docs/MEMORY.md`, writing). Nothing is promoted by a pass on its own.
- **Pruning.** Once promoted, the lesson leaves `memory/lessons.md` (the ledger line stays: it is
  the record, and now says where the rule lives). A lesson that stopped being true leaves too,
  and the pull request says why. `progress/` is never pruned: it is the raw log, and the paper's
  point is that the *abstractions* move up, while the raw record stays where it was.

### 3. REM: a pass that practises

The paper's dreaming is the new idea for a codebase. A pass that doesn't curate memory but
*exercises the system*, and keeps only what finds something:

- **Mix.** Pair two parts of the repository that don't usually meet: the threat model against the
  newest feature; a Leo program's tests against the app's parser for its records; a rule in
  `docs/INVARIANTS.md` against the check that claims to enforce it; a design document against the
  code that says it was built. The pairing is random on purpose (the paper's "random expert
  selection"): the point is to find what a straight line of work never crosses.
- **Practise.** For each pair, write what would break it: an adversarial test, a must-fail input,
  a question the two documents answer differently.
- **Select by effect.** Keep only what *finds* something: a test that fails, a contradiction, a
  rule with no check, a status that lies. Everything else is discarded, and the discarded dreams
  are never written anywhere.
- **Output.** One pull request of findings, each citing the two things it crossed and the test or
  question that showed it. Never a fix, never a rule change, never merged on its own. A finding
  becomes a task for a working session, through Joshua.

The pass is isolated (a fresh session, or a skill run in a forked context), so it carries none of a
working session's assumptions, and it reads nothing about a person's books, keys or money.

## The rhythms

Sleep is periodic and happens whether or not much came in (Joshua, 2026-11-07): a pass runs
regardless, and when there is nothing to do it says so and stops. "Runs regardless" is satisfied
by the Routine's run history, never by an empty commit or an empty pull request.

| Pass | When | Reads | Does | When there is nothing |
|---|---|---|---|---|
| **Compaction** (consolidate and wake) | Every session, whenever context is summarised | The session's state | The two hooks above | Not applicable |
| **Light sleep** (consolidate) | Nightly, about 3 a.m. Pacific | `git log --since=yesterday` first; then the day's progress entries and merged pull requests | Verifies the day's statuses and the Now block, files the day's decisions and lessons in `memory/`, nothing else | Stops after the log, in a minute or two, ending with "Nothing needed". No pull request |
| **Deep sleep** (dream) | Weekly, Sunday evening Pacific, as today | The week, the transcripts the entries name, the whole memory store | Everything the dream did before (`.claude/skills/dream/SKILL.md`), plus promotion candidates and pruning | Still opens its pull request: the week's record says it was verified |
| **REM** | Monthly, first Sunday, after the dream | Two random parts of the repository | The practice above | Ends with "Nothing found". No pull request |

The rule for all of them: a pass that changes a file opens a pull request Joshua approves
(OPS-01); a pass that changes nothing writes nothing. A pass never rewords a rule, never merges,
never prints a key, and never carries a `https://claude.ai/…` link; its progress entry, when it
writes one, ends with its bare session id (`docs/MEMORY.md`).

One sleep pull request is open at a time (2026-11-09). A pass starts by listing the open pull
requests: with a light sleep or a dream still waiting for Joshua, it works on that branch
(merged up to `main`) and updates that pull request rather than opening another, so what the
earlier pass filed is verified, not filed twice; with two open, it stops and says so. The first
dream that ran from `main` while the night's light sleep waited repeated four of its decisions,
and the two conflicted. Both passes also fetch the `pnw_mvp_v2` submodule first, so the Leo
paths the rules cite get checked.

Cost: each pass is a fresh cloud session. An empty nightly run is a minute; a busy one is about a
tenth of a working session; the weekly dream is unchanged; REM is bounded by how many pairs it
draws (three, to start). The cadence of each is one setting on its Routine.

## The pieces, as a plugin

The five pieces are hooks and skills in `.claude/`, written against the repository's own
conventions in `CLAUDE.md` rather than Hewn's names, so that another repository gets the same cycle
by installing the plugin and writing its conventions. Hewn is the first user.

| Piece | Kind | Stage | Invoked by |
|---|---|---|---|
| `wake` | `SessionStart` hook (`startup`, `resume`, `compact`) | wake | The harness |
| `consolidate` | `PreCompact` hook, plus the snapshot script it runs | consolidation | The harness |
| `/rest` | skill | consolidation, end of task | The agent, at the end of every task: the `CLAUDE.md` checklist (progress entry, the indexes, the checks, the commit) as one command, so it is never skipped. Built 2026-11-07: `.claude/skills/rest/SKILL.md` |
| `/dream` | skill, `context: fork`, model-invocable off | consolidation, weekly | The "Hewn dreaming" Routine, whose prompt becomes one line; or Joshua by hand. Carries today's `PROMPT.md`, with promotion and pruning added. Built 2026-11-07: `.claude/skills/dream/SKILL.md` (the former `scripts/dreaming/PROMPT.md`); the Routine's prompt names the file, since a Routine typing `/dream` isn't documented |
| `/light-sleep` | skill, `context: fork` | consolidation, nightly | A second Routine. Built 2026-11-07: `.claude/skills/light-sleep/SKILL.md`; the Routine's settings in `.claude/skills/README.md`, created from the Routines page (only there does a Routine get push access) |
| `/rem` | skill, `context: fork`, model-invocable off | REM, monthly | A third Routine; its first run fired by hand and reviewed, like the first dream. Built 2026-11-07: `.claude/skills/rem/SKILL.md`; the pairs drawn by `scripts/sleep/rem_pairs.py --seed <date>` (random across seven categories, repeatable); findings in `docs/incidents/rem-<date>.md` |

Skills take `disable-model-invocation: true` where only a person or a Routine should start them
(`/dream`, `/rem`), and `context: fork` where the pass must not see the working conversation.
Hooks and skills in the repository apply in local sessions and in single-repository cloud
sessions, which is what every Routine's session is.

## What stays as it is

- Every merge is Joshua's (OPS-01). No pass may approve, merge, or change a rule's wording or id.
  The paper's safety comes from frozen old weights and a measured reward; ours comes from the
  human gate and from the checks in CI.
- Memory stays in the repository, in the three scopes, in plain Markdown (`docs/MEMORY.md`).
- Nothing about a person's books, keys or money enters any pass (INV-01, INV-06).

## The order

1. **This document** (2026-11-07), and the decision in the ledger.
2. **`consolidate` and `wake`**: the two hooks and the snapshot script, with a test that the
   script writes and reads the state it should; tried in a local or single-repository session.
3. **`/rest` and `/dream`** as skills, `/dream` carrying `PROMPT.md` with promotion and pruning;
   the Routine's prompt points at `/dream`. The nightly `/light-sleep` and its Routine.
   Built 2026-11-07 (`.claude/skills/`); the nightly Routine's first run is reviewed before its
   schedule stands, like the first dream.
4. **`/rem`**, its first run by hand and its findings reviewed before its Routine stands.
   Built 2026-11-07 (`.claude/skills/rem/`, `scripts/sleep/rem_pairs.py`); the first run is
   next.
5. **The plugin**, once the pieces have run on Hewn for a few weeks: the same files, installable
   elsewhere.

## Sources

- Behrouz, A. and Mirrokni, V., "The sleep framework: A new way for LLMs to retain knowledge in
  continual learning", Google Research blog, 2026-10-27:
  https://research.google/blog/the-sleep-framework-a-new-way-for-llms-to-retain-knowledge-in-continual-learning/
- Behrouz, A., Hashemi, F., Javanmard, A. and Mirrokni, V., "Language Models Need Sleep: Learning
  to Self-Modify and Consolidate Memories", arXiv 2606.03979 (§2.2 the continuum memory system,
  §3.1 the phases, §3.2 and §3.3 consolidation, §3.4 dreaming): https://arxiv.org/abs/2606.03979
- Claude Code documentation, read 2026-11-07: hooks (`PreCompact`, `SessionStart` and its
  `compact` matcher, `SessionEnd`, `Stop`), skills (frontmatter, `context: fork`,
  `disable-model-invocation`), memory (auto memory is machine-local), settings in cloud sessions
  (repository hooks and skills apply with one repository attached): https://code.claude.com/docs
- `docs/MEMORY.md`, the design this one extends; `.claude/skills/dream/SKILL.md`, the dream as it runs.
