# The job board: design

Status: **`hewn_jobs_v1.aleo` merged in PNWBNW/pnw_mvp_v2 (#206, #207), deploying to testnet**
(Joshua, 2026-10-19). In the app: posting from the business's Jobs page (#94), and the public board
(`/board`, with the worker's "Find work"). Next: applying, the applications and applicants lists.

## What it is

A public job board inside Hewn (Joshua, 2026-10-19): businesses post jobs anyone can read, people
apply privately, and each side keeps track of where things stand. "Indeed, rolled into the fold."
Only for the Hewn ecosystem: posting is gated on chain by owning a business `.hewn` name on the
registry, so a fork running its own registry can read the board but can't post to it.

The split follows the privacy floor:

| | Where it lives | Who sees it |
|---|---|---|
| A posting (title, location, description, pay range, kind of work, hours, where) | Public mappings of `hewn_jobs_v1.aleo` | Anyone |
| Who posted it | Its `.hewn` name hash, public | Anyone (the name is public already) |
| An application (name, message, resume) | A sealed letter to the business (`hewn_letters_v2`) | The two of them |
| Replies, interview time and place, "not selected", an offer | Letters, as everything between two people already is | The two of them |
| The business's applicants, the person's applications and their statuses | Each side's own vault | Each side alone |

The program never sees an applicant. Nothing on chain says who applied to what, or how many did.

## The program (`pnw_mvp_v2/src/layer1/hewn_jobs_v1.aleo`)

| Call | Costs (USDCx, plus the network fee) | Does |
|---|---|---|
| `post(id, name_hash, suffix_code, pay_type, pay_min, pay_max, employment_type, hours_per_week, place, body)` | $1 to the Hewn foundation | Adds a posting under the business's name, at the next index |
| `update(…the same…)` | free | Replaces an open posting's facts and words |
| `feature(id, name_hash, suffix_code, days)` | $5 a day | Keeps an open posting near the top for `days` more days (1 to 30; stacks on what's left, never more than 30 days ahead) |
| `close(id, name_hash, suffix_code)` | free | Closes it for good (post again to reopen) |

- **The gate:** every call runs the registry's `assert_employer_owner(name_hash, signer, suffix_code)`
  after checking the industry code is 1 to 40. A business name always has a code in that range; a
  worker name has 0, so a worker can't post under their own name (Codex finding on #206). The app
  reads the code from the registry's `employer_suffix_code` before each call.
- **Fees** are public `transfer_public_as_signer` calls on USDCx from the signer's public balance to
  the foundation treasury, the account the name registrar pays. If any check fails, nothing is
  charged. A posting is public anyway, so a public fee gives nothing away. The business's account
  needs a public USDCx balance of at least $1 to post.
- **The facts** anyone can filter on: pay in cents with `pay_type` 0 not shown, 1 an hour, 2 a
  year; `employment_type` 0 not stated, 1 full-time, 2 part-time, 3 seasonal, 4 temporary, 5
  contract; `hours_per_week` in tenths (375 is 37.5, at most 1,680); `place` 0 not stated, 1 on
  site, 2 remote, 3 hybrid; `posted_height`; `open`; `featured_until` (a block height, 0 never).
- **The words** (`posting_body[id]`): title, location and description as a JSON array, deflated
  when smaller, packed into 40 field elements the way letters are (31 bytes a field, 2-byte length):
  1,238 bytes. Plain English deflates about 3:1, so a 4,000-character description usually fits; the
  app refuses one that doesn't before Shield is asked.
- **Listing without a server:** `posting_count[0u8]` is how many postings there have ever been and
  `posting_at[i]` the id of the i-th, so any page can walk them straight from the explorer. The
  board shows postings whose `featured_until` is still ahead first (latest window first), then the
  rest newest first. A day is 28,800 blocks, about one block every 3 seconds, the same assumption
  the app makes for offer dates.
- `@noupgrade`: a change ships as `hewn_jobs_v2`. 31 Leo tests, 26 of them must-fail (an unowned
  or worker name, a wrong code, a posting or a feature without the money or a cent short, 0 or 31
  days, 20 days twice, featuring a closed or someone else's posting, and each bad value).

## The app

### Business: Jobs (this PR)

`/jobs`, in the business's navigation. The list comes from the vault (`books/jobs.ts`, the
`jobs` part of the company file: the business's own copy of each posting, with when it was posted,
the transaction, and when it was changed, featured or closed). The chain code (`chain/jobs.ts`,
`chain/JobPanel.tsx`) loads only when the business posts, changes, features or closes something:

- **New posting:** title, location, description (with a character count), pay (not shown, an
  hour, a year; from and to), kind of work, hours a week, where. The same checks the program makes
  run first, the words are packed, then one Shield approval: `post`, $1. The posting id is 31 random
  bytes.
- **Change:** the same form, filled in; `update`, free.
- **Feature:** reads the chain for the current height and the posting's window, offers 1 to the
  days still allowed (30 less what's ahead), shows the cost, one approval: `feature`.
- **Close:** one approval: `close`. The posting stays in the list, marked closed.
- Every call needs Shield on the linked account and the business name registered; the industry
  code is read from the registry each time the panel opens.

### The board (`/board`)

In the app, not the marketing site: the site is a brochure with no chain reads and a security
policy that names no host, while the app already reads the explorer. `/board` is the one public
path: `BooksGate` lets it through without open books and `AppShell` shows a bare header (the brand
and "Open Hewn") instead of the rail; with books open it is an ordinary page, "Find work" in a
worker's navigation and reachable by a business too (no role redirect). `chain/board.ts` reads the
newest 100 postings (`readRecent`), the current height, and each business's name from the
registry's reverse resolver (once per name; a name that can't be read shows as "A business"),
orders them featured-first, and filters on words (every word must appear in the title, location,
description or business name) and on the facts. `chain/Board.tsx` is the page: search, three
filters, Refresh, each posting opening to its description, and for a visitor "Open Hewn to apply".
A posting written for a newer app (a body this one can't unpack) is listed without its words.

### Applying, and a person's applications (next)

Apply is the next PR; the board shows "Applying from here comes next" to a signed-in worker until then.

An application is a letter to the business's account (looked up from its name on the registry):
the person's `.hewn` name, a message, and a full resume as text. A resume builder guides people who
don't have one; "Import from PDF" extracts the text locally (a PDF can't go on chain). The person's
vault lists each application with its status: Applied, Seen, Interviewing, Offer sent, Hired, Not
selected, Posting closed. Statuses arrive as letters from the business.

### Business: applicants (next)

Each posting lists its applicants, from the application letters in the vault. From an applicant:
read the resume, message them (the existing conversation), set up an interview (a time and a place
or a meeting link, sent as a letter; video calls happen on Teams or the like, not on chain), send
an offer (the existing offer flow, pre-filled from the posting), or mark Not selected (a letter).

## Decisions

- 2026-10-19 (Joshua): pay on a posting optional ("Yes"); applications are name + message + full
  resume as text, with a builder and a local PDF import; the employer pays the network fee plus a
  small fee to the Hewn foundation: $1 a posting; featured $5 a day, capped at 30 days.
- 2026-10-19: a posting belongs to the name, not the wallet (Codex, #206): if a business sells its
  name back, whoever registers it later holds its old postings and can close them. The app's
  sellback flow should close open postings first. Not changed in the program.
- 2026-10-19: interviews are not on chain. Letters carry the time and the place or link.
