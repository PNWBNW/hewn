# `.claude/skills/` — the sleep cycle's passes

The skills of `docs/SLEEP.md`: each is a `SKILL.md` the harness loads from this folder (in local
sessions and in cloud sessions; a Routine's fresh session reads the file by path, which is proven,
rather than typing the slash command, which isn't documented). The hooks that run on their own
are in `scripts/sleep/`.

| Skill | Rhythm | Who starts it | What it does |
|---|---|---|---|
| `/rest` | End of every task | The working session itself | `CLAUDE.md`'s end-of-task checklist as one command: checks, the signed progress entry, the indexes, exit criteria, commit, pull request, stop. Runs in the working context, since it writes about that work |
| `/dream` | Weekly, Sunday evening Pacific | The "Hewn dreaming" Routine (a fresh session on `main`), or Joshua | The deep pass (`docs/MEMORY.md`): verify, organize, enrich the team's memory over the week; name promotion candidates and prune what was promoted or stopped being true; always one pull request, `dreaming: week of <date>`. Forked, model invocation off |
| `/light-sleep` | Nightly, about 3 a.m. Pacific | The "Hewn light sleep" Routine, or Joshua | One day's consolidation: `git log --since="1 day ago"` first; "Nothing needed" and stop when it is empty, else verify the day and file its decisions and lessons; a pull request only when a file changed. Forked, model invocation off |

Every pass changes only team memory, never a rule's wording or id, never code; never merges
(OPS-01); never prints a key; never writes a `https://claude.ai/…` link. `/rem`, the monthly
practice pass, comes next in the order `docs/SLEEP.md` gives.

**The Routines.** A Routine must carry the repository as a source with push access, which only
the Routines page of claude.ai can give it (a Routine made from inside a session can clone but
not push; `memory/lessons.md`). Each Routine's prompt is a few lines pointing at its `SKILL.md`,
so nothing there changes when the file does:

- *Hewn dreaming*, `CRON_TZ=America/Los_Angeles 51 20 * * 0`: "You are the weekly dreaming
  session for Hewn (PNWBNW/hewn). Make sure the checkout is at the tip of main
  (`git fetch origin main && git checkout -B dreaming-start origin/main`), then read
  `.claude/skills/dream/SKILL.md` in full and do exactly what it says, nothing more. Never touch
  code, tests or the wording of a rule; never merge; never put a claude.ai link in anything you
  commit or post. If a push is refused, do not look for a way around it: end with the three parts
  of the pull request as your last message and say the push was refused."
- *Hewn light sleep*, `CRON_TZ=America/Los_Angeles 45 2 * * *`: "You are the nightly light-sleep
  session for Hewn (PNWBNW/hewn). Make sure the checkout is at the tip of main
  (`git fetch origin main && git checkout -B light-sleep-start origin/main`), then read
  `.claude/skills/light-sleep/SKILL.md` in full and do exactly what it says, nothing more. When
  nothing merged since yesterday, end with "Nothing needed" and stop. Never touch code, tests or
  the wording of a rule; never merge; never put a claude.ai link in anything you commit or post.
  If a push is refused, do not look for a way around it: end with the two parts of the pull
  request as your last message and say the push was refused."

**By hand:** `/dream` or `/light-sleep` in a session on `main`, or fire the Routine from the
Routines list.
