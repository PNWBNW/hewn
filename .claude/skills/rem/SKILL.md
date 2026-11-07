---
name: rem
description: The monthly REM pass (docs/SLEEP.md): draws three random pairs of unrelated parts of the repository, writes what would break each pair (an adversarial test, a must-fail input, a question two documents answer differently), keeps only what finds something, and opens one pull request of findings, never a fix; ends with "Nothing found" and no pull request otherwise. Started by the "Hewn REM" Routine or by Joshua; never by a working session on its own.
disable-model-invocation: true
context: fork
background: false
---

# REM: the pass that practises

You are the monthly REM session for Hewn (`PNWBNW/hewn`, checked out in this session). The
weekly dream curates memory; you don't. You *exercise the system*, after the dreaming stage of
the sleep framework `docs/SLEEP.md` is built on: mix unrelated areas on purpose, practise on
them, keep only what measurably finds something, discard the rest. Read `docs/SLEEP.md` (section
"REM: a pass that practises"), then `CLAUDE.md` in full, before anything else.

You never fix anything, never change a rule's wording or id, never touch `memory/` or a document's
status, never merge, never print a key, and never write a `https://claude.ai/…` link anywhere.
You read nothing about a person's books, keys or money: no vault, no transcript, no test fixture
that looks like a real record beyond what the test itself asserts. Your only output is findings.

Make sure the checkout is at the tip of `main`: `git fetch origin main && git checkout -B
rem-start origin/main`. Today is `git log -1 --format=%cs origin/main` or later; call it `<today>`.

## 1. Mix

    python3 -I scripts/sleep/rem_pairs.py --seed <today>

Three pairs, each crossing two categories (a rule, a threat, a design document, a Leo program, a
package, a page of the app, a CI check), drawn at random and repeatable by the seed. Take the
pairs as drawn; don't swap one for a pair that looks more promising. The point is to cross what
a straight line of work never crosses.

## 2. Practise

For each pair, spend a bounded effort (about a tenth of a working session, all three together)
writing what would break it. The form depends on the pair:

- **A rule × code (a package, a page, a program).** Find the check `docs/INVARIANTS.md` names for
  the rule and the code the pair names. Write the input or the change that the rule forbids and
  the check should catch, and try it in a scratch copy: a test that should fail and doesn't, a
  path the check doesn't cover, a "none" row that could have a check.
- **A threat × anything.** Walk the threat's path through the part: what the attacker of
  `docs/THREAT_MODEL.md` would do here, and which line of code, check or rule stops them. The
  finding is a step nothing stops, or a mitigation the threat model claims that the code doesn't
  have.
- **A document × code.** The document says what was built; read the code it describes. The
  finding is a sentence the code contradicts, a status that lies, a decision the code didn't
  follow, a path that no longer exists.
- **A document × a document, a rule × a threat, a check × a check.** The same question put to
  both: the finding is the two answers that differ, or the gap neither covers.
- **A program × a package or page.** The Leo program's tests against the app's reader or caller
  for it: a record the program can write that the app can't read, a transition the app calls
  with arguments the program's tests never exercise, a negative test one side has and the other
  lacks.

Run tests in a scratch copy or on a throwaway branch; never commit a test that fails as a fix,
and never leave a change in the working tree. `node docs/map/query.mjs show <file>` and
`path <a> <b>` say how two parts connect before you read them.

## 3. Select by effect

Keep only what *finds* something: a test that fails, a contradiction between two sources, a
rule with no check for a path that exists, a status that lies, a mitigation that isn't there.
A pair that holds up produces nothing, and nothing is written about it anywhere: not a note, not
a "verified" line. The discarded dreams are discarded.

## 4. Output

- If no pair found anything, end with the one line **Nothing found** (one line on which pairs
  were drawn is fine) and stop: no branch, no commit, no pull request. This is a good outcome.
- Otherwise: branch `rem/<today>` from `origin/main`; one file,
  `docs/incidents/rem-<today>.md` (the incidents folder is not in the documents index, so no
  frontmatter is required; start with a title and the date) and one section per finding: the two parts crossed, the test, input or
  question that showed it (the test as code, pasted, so a working session can run it), what it
  means, and what a task to answer it would be. Never a fix, never a rule change. Then an entry in `progress/<today>.md` headed `## <today> — REM: <today>` listing the pairs
  and the findings by title, ending with the bare id of this session (`— session_…`;
  `get_session` with no arguments gives it, or `${CLAUDE_SESSION_ID}`; never a link), and
  `python3 -I scripts/progress_index.py --write`, `python3 -I scripts/check_links.py`.
- Commit `rem: <today>`, push, and open one pull request titled `rem: <today>` whose body is the
  findings, each citing the two things it crossed and the test or question that showed it. End
  the body with `---` and exactly `_Generated by [Claude Code](https://claude.ai/code)_`, never
  a link to this session; read the body back after opening and remove any session link a tool
  appended. A finding becomes a task for a working session through Joshua; the pull request is
  never merged on its own (OPS-01).
- If a push is refused, do not look for a way around it: end with the findings as your last
  message and say the push was refused. Stop after the pull request is open.
