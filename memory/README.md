# memory/

Team memory (`docs/MEMORY.md`): what has been decided and what has been learned, consolidated
in one place so a session finds it without reading every document. Agents append here freely in
their own pull request; the weekly dreaming pass (`.claude/skills/dream/SKILL.md`) verifies, merges
and prunes it in its own.

| File | What |
|---|---|
| `decisions.md` | Every decision made, one line each: the date, the decision, who made it, where it is enforced (a rule id in bold where it became one), where it was recorded. Two levels: ten groups, each with subcategories that say in one line what belongs in them. The documents keep their own "Decisions" sections as the record of the moment; this is the ledger across them. |
| `lessons.md` | What was learned the hard way and would be relearned without it: a tool that bites, a network that behaves oddly, a wall that is a wall. Each with where it came from. |

Rules, invariants and threats are not here: they are org knowledge (`CLAUDE.md`,
`docs/INVARIANTS.md`, `docs/THREAT_MODEL.md`) and change only by a pull request about them. A
decision that becomes a rule is recorded here with the date it did.
