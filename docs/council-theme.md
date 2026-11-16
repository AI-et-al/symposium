# Symposium — "the chamber" theme for `convene_council` output

Three worked examples of the MCP text payload, then a note on what renders safely.
Checked against `src/` at `0a16e61` (Phase 4 landed: timeouts, cap abort, redaction).

## The palette

Every seat owns a hue and keeps it everywhere it is named — roll table, position
heading, dissent quote, synthesis verdict, casualty list. Identity is carried by
the chip; **status is a separate axis** and is marked only when something went
wrong.

| Seat | Chip | Bar fill | Hue |
|---|---|---|---|
| Claude | 🟠 | 🟧 | Anthropic terracotta |
| GPT | 🟢 | 🟩 | OpenAI green |
| Gemini | 🔵 | 🟦 | Google blue |
| Grok | ⚫ | ⬛ | xAI monochrome |
| DeepSeek | 🟣 | 🟪 | DeepSeek violet |
| Qwen | 🟡 | 🟨 | Qwen yellow (red is reserved for a breached budget) |
| Claude Code | 🧡 | 🟧 | Anthropic terracotta, retained |
| Codex | 💚 | 🟩 | OpenAI green, retained |
| Antigravity | 💙 | 🟦 | Google blue, retained |

**Retained seats wear hearts (v0.7).** A retained seat — the operator's own
subscription CLI, carrying their context — keeps its provider's hue but swaps the
circle for a heart: a seat that belongs to someone. Identity (hue) and provenance
(shape) are separate axes, exactly as identity and status are. The bar fill is
shared with the provider's neutral seat, which is safe for the same reason the
bars were already safe: no bar appears without its numeral, and no bar shares a
line with another seat's content. Chip substitution matches longest-name-first
("Claude Code" before "Claude") so a retained
seat's attribution line can never be half-chipped with its neutral sibling's
color — the implementation sorts `SEAT` keys by length and the test suite pins
it (`test/theme.test.ts`).

| Glyph | Meaning |
|---|---|
| ⬜ | an unfilled bar cell, for every seat |
| `◐` `✗` `○` | malformed · errored or refused · seat empty, no API key |
| `△` / `▲` | least sure / strongest objection to own position |
| `⚠` | dissents from the framing; or a warning about the convening itself |
| `⚖` `§` `†` | dissent · synthesis · open questions (council stops) |
| `▓` `▒` `█` | monochrome bands: dissent · degraded convening · a guarantee unkept |
| 🟩 / 🟥 | budget meter — spend within cap / cap breached. Red is never decoration |

Three composition rules keep this from breaking: **every bar and band is alone on
its own line or alone in its table cell** (emoji squares are two columns wide and
must never sit inline with prose); **every decorative line is its own block**,
blank line above and below; and **color means exactly two things** — which seat is
speaking, and whether the budget held. Nothing else is colored, which is why the
DISSENT band is monochrome `▓` even though it is the loudest thing in the output.

`●` is gone from the healthy rows. It used to mark "this seat spoke," but a chip
above a filled bar already says that, and `● ⚫ Grok` is a stutter of two black
circles at different widths. Status marks now appear only when the status is not
`ok`, which makes the failures louder by contrast. `○` is the one glyph no example
demonstrates: a fourth empty seat would drop convening C to a single voice, and
`planCouncil` refuses below two (spec §3), so a skipped seat can only appear in a
council that still had quorum.

**Monochrome fallback.** Where emoji render poorly, the same row degrades to the
original ladder with no loss of meaning — `🟠 Claude` → `● Claude`,
`🟧🟧🟧🟧🟧🟧🟧⬜⬜⬜ 0.72` → `▓▓▓▓▓▓▓░░░ 0.72`, `🟥` → `█`. Worth an env switch
(`SYMPOSIUM_MONOCHROME=1`) rather than a rewrite, since both ladders are the same
ten cells.

Examples are fenced so the glyph sequences are exact — the tool emits the fence
*contents* verbatim as its text payload. Prose is unwrapped, as the real output
is: advisor positions arrive as one paragraph and `server.ts` never re-wraps them.

They run 83, 90, and 72 lines, against 66/73/58 for the monochrome draft. Color
costs about twenty lines per convening, and it goes almost entirely to one rule:
an emoji bar is two columns per cell, so it cannot share a line with prose the way
`▓▓▓▓▓▓▓░░░` could. Every position block therefore gains a bar line and a blank.
The diff blocks account for the rest.

---

## A · Standard medium-stakes convening, 2–2 split

````markdown
# 🏛️ SYMPOSIUM — the council is convened

> **Should we replace our hand-rolled retry logic with Temporal?**

`stakes medium` · `tier medium` · `4 of 4 seats` · `⚖ 2 dissents` · `synth grok-4.5` · `est $0.1004 of $0.2500`

## THE FLOOR · 🟠🟢🔵⚫

| Voice | Confidence | Stance |
|---|---|---|
| 🟠 Claude | 🟧🟧🟧🟧🟧🟧🟧⬜⬜⬜ 0.72 | Adopt — scoped to payment capture |
| 🔵 Gemini | 🟦🟦🟦🟦🟦🟦🟦⬜⬜⬜ 0.66 | Adopt — all async work or none |
| 🟢 GPT | 🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜ 0.61 | Decline — the bug is idempotency |
| ⚫ Grok | ⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜ 0.81 | Decline — a scheduler is not a fix |

#### 🟠 Claude · `claude-sonnet-5`

🟧🟧🟧🟧🟧🟧🟧⬜⬜⬜ **0.72**

Adopt Temporal for payment capture only — the one flow where a dropped retry costs money and the state machine already spans four services. Leave webhook redelivery and transactional email on the existing helper.

- ▲ *Own objection:* a scoped adoption leaves two retry semantics in one codebase, and the seam between them is where the next outage lives.

#### 🔵 Gemini · `gemini-3.6-flash`

🟦🟦🟦🟦🟦🟦🟦⬜⬜⬜ **0.66**

Adopt it for every async path or not at all. The value on offer is a single durable execution model; running two is worse than running the bad one consistently.

- △ *Least sure:* whether a team of nine can absorb a wholesale migration inside one quarter.

#### 🟢 GPT · `gpt-5.6-terra`

🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜ **0.61**

Decline. The duplicate captures are a missing-idempotency-key bug; Temporal would hide it behind exactly-once semantics you would then depend on forever.

- ⚠ *Dissents from the framing:* "replace the retry logic" presumes retries are the defect. Nobody has yet shown a failure that correct idempotency keys would not also fix.

#### ⚫ Grok · `grok-4.20-0309-non-reasoning`

⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜ **0.81**

Decline. You would be adding a cluster, a worker fleet, and a new on-call rotation to a team that has not yet written a runbook for the system it already has.

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

## ⚖ DISSENT — 2 material disagreements, verbatim

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

### ⚖ 1 · Whether the defect is retry logic or idempotency

> **🟠 Claude —** "the state machine already spans four services; that is not a retry helper's job"
>
> **🟢 GPT —** "you are buying a workflow engine to paper over missing idempotency keys — the retries were never the bug"

### ⚖ 2 · Scoped adoption versus all-or-nothing

> **🔵 Gemini —** "a partial migration is the worst available state: two retry semantics, one codebase, and nobody able to say which owns a given failure"
>
> **🟠 Claude —** "adopt for payment capture only; webhook redelivery does not justify a cluster"

---

## § SYNTHESIS

```diff
+ adopts   🟠 Claude   scoped adoption — payment capture, nothing else
+ adopts   🟢 GPT      idempotency keys first, as a precondition not a rival
- rejects  🔵 Gemini   all-or-nothing; the seam is one queue boundary
- rejects  ⚫ Grok     blanket decline; leaves the duplicates unexplained
```

Fix the idempotency keys on payment capture first, then move that flow — and only that flow. 🔵 Gemini's all-or-nothing claim treats the seam as unmanageable when it is one queue boundary that can be named and tested. ⚫ Grok's decline does not answer why a four-service state machine keeps producing duplicate captures.

---

`adjourned` · **$0.0341** actual (est. $0.1004) · 46.8 s

🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜ 14% of the $0.2500 cap

`ledger` → `ledger/2026-08-06-2014-should-we-replace-our-hand-rolled-retry-logic.md`
````

---

## B · High-stakes convening — ends in open questions, no conclusion

````markdown
# 🏛️ SYMPOSIUM — the council is convened

> **Should we sunset the v1 API on 31 January with no extension?**

`stakes high` · `tier high` · `4 of 4 seats` · `⚖ 3 dissents` · `synth grok-4.5` · `est $0.1417 of $1.0000`

> ⚠️ **HIGH STAKES — this council will not conclude.** It ends with the questions a human must answer. Do not read past the dissent expecting a recommendation.

## THE FLOOR · 🟠🟢🔵⚫

| Voice | Confidence | Stance |
|---|---|---|
| 🔵 Gemini | 🟦🟦🟦🟦🟦🟦🟦⬜⬜⬜ 0.71 | Hold the date — no exceptions |
| ⚫ Grok | ⬛⬛⬛⬛⬛⬛⬜⬜⬜⬜ 0.63 | Hold only if v2 has parity today |
| 🟠 Claude | 🟧🟧🟧🟧🟧🟧⬜⬜⬜⬜ 0.58 | Hold, carve out the two contracts |
| 🟢 GPT | 🟩🟩🟩🟩⬜⬜⬜⬜⬜⬜ 0.44 | Wrong instrument — usage, not a date |

#### 🔵 Gemini · `gemini-3.1-pro-preview`

🟦🟦🟦🟦🟦🟦🟦⬜⬜⬜ **0.71**

Hold the date. Every extension granted so far has been consumed and followed by a request for another; the deadline is the only forcing function left, and v1 carries an unpatched auth path you are choosing to keep alive.

#### ⚫ Grok · `grok-4.5`

⬛⬛⬛⬛⬛⬛⬜⬜⬜⬜ **0.63**

Conditionally hold. You cannot cite a deadline for an endpoint whose replacement still lacks bulk export — that is not a migration, it is an eviction.

#### 🟠 Claude · `claude-opus-5`

🟧🟧🟧🟧🟧🟧⬜⬜⬜⬜ **0.58**

Hold the public date and carve out the two enterprise contracts explicitly. A named, dated, contractual exception is not an extension; it is the difference between a policy and a breach.

#### 🟢 GPT · `gpt-5.6-sol`

🟩🟩🟩🟩⬜⬜⬜⬜⬜⬜ **0.44**

Sunset on a usage threshold instead — below 1% of calls for thirty consecutive days — and the date sets itself, per customer, without anyone having to defend a number. ⚠ *The question asks when; the live disagreement is whether a date is the instrument at all.*

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

## ⚖ DISSENT — 3 material disagreements, verbatim

▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓

### ⚖ 1 · Whether a calendar date is the right instrument

> **🟢 GPT —** "a date punishes precisely the customers who are hardest to move, and rewards the ones who were never at risk"
>
> **🔵 Gemini —** "a usage threshold is a deadline nobody can plan against; it converts a decision you own into a wait you do not"

### ⚖ 2 · Whether a contractual carve-out is an extension

> **🟠 Claude —** "a named, dated exception in a signed contract is not an extension — it is the contract"
>
> **🔵 Gemini —** "every extension began as an exception with a name on it"

### ⚖ 3 · Whether v2 is actually ready to receive the traffic

> **⚫ Grok —** "bulk export is not shipped; until it is, the date is an eviction notice with a migration guide stapled to it"
>
> **🟠 Claude —** "parity is a moving target and has been used to defer this twice already"

---

## † OPEN QUESTIONS FOR THE HUMAN

```diff
- adopts   nothing. No position was adopted.
- rejects  nothing. No position was rejected.
- decides  nothing. Stakes are high; the council stops here by rule.
+ returns  four questions, and the dissent above, to you
```

Four voices, three unresolved fault lines, and the highest confidence on the floor is 0.71. Answer these and most of the dissent resolves itself:

1. Do the two enterprise contracts guarantee *endpoints* or a *service level*? 🟠 Claude's carve-out and 🔵 Gemini's no-exceptions rule are the same position under different answers.
2. Is v2 bulk export shipped and documented today? If not, ⚫ Grok's objection is dispositive and the date cannot hold.
3. What does one more quarter of v1 actually cost — engineering hours, or the unpatched auth path 🔵 Gemini names? Only the second is an argument.
4. If 12% of revenue churns in February, who owns that outcome, and is it the person deciding this?

---

`adjourned without conclusion` · **$0.0912** actual (est. $0.1417) · 71.4 s

🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜ 9% of the $1.0000 cap

`ledger` → `ledger/2026-08-06-2102-should-we-sunset-the-v1-api-on-31-january.md`
````

---

## C · Degraded convening — one error, one malformed, cap breached, no synthesis

````markdown
# 🏛️ SYMPOSIUM — convening degraded

> **Should the ledger format ship CC0 while the server stays AGPL-3.0?**

`stakes high` · `tier high` · `2 of 4 voices` · `synth ✗ aborted` · `est $0.1417 of $0.1500`

▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒

## ⚠ THE RECORD IS INCOMPLETE

▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒

- `✗` ⚫ **Grok** (`grok-4.5`) — errored: Grok advisor call timed out after 60000 ms. No position, nothing billed.
- `◐` 🔵 **Gemini** (`gemini-3.1-pro-preview`) — malformed: reply was not valid JSON matching the contract, after one retry. Two calls billed at $0.0270, no position recovered.
- `✗` **Synthesis** — aborted before it ran. Three seats needed a retry, putting actual spend at **$0.1518** against the $0.1500 cap — and only because the seat that failed outright was the cheapest one on the floor. Positions already returned are preserved; nothing was synthesized.

## THE FLOOR · 🟠🟢 spoke · 🔵⚫ silent

| Voice | Confidence | Stance |
|---|---|---|
| 🟠 Claude | 🟧🟧🟧🟧🟧🟧🟧⬜⬜⬜ 0.74 | Split them — CC0 the format |
| 🟢 GPT | 🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜ 0.61 | Copyleft the format too |
| ◐ 🔵 Gemini | ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ ✗ | *no position — malformed* |
| ✗ ⚫ Grok | ⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜ ✗ | *no position — timed out* |

#### 🟠 Claude · `claude-opus-5`

🟧🟧🟧🟧🟧🟧🟧⬜⬜⬜ **0.74**

Split them. A format spreading further than your server is the entire point of writing a spec, and CC0 costs you nothing you could ever have charged for — the leverage sits in the server, and AGPL already holds it there.

- ⚠ *Seat note:* first reply was cut off mid-JSON; recovered on the contract's single retry, at double cost.

#### 🟢 GPT · `gpt-5.6-sol`

🟩🟩🟩🟩🟩🟩⬜⬜⬜⬜ **0.61**

Copyleft the format as well. A CC0 spec under an AGPL server is an open invitation to a proprietary reimplementation that adopts your format, absorbs the ecosystem, and contributes nothing back.

- ⚠ *Seat note:* first reply was cut off mid-JSON; recovered on the contract's single retry, at double cost.

████████████████████████████████████████████████

## ⚖ DISSENT — NOT ADJUDICATED

████████████████████████████████████████████████

**No synthesizer was paid to reproduce this disagreement.** The quotes below were excerpted mechanically from the two positions above — nothing here has been read, compared, or attributed by a synthesis pass. This is the raw record, and the reader is the synthesizer.

> **🟠 Claude —** "a format spreading further than your server is the entire point of writing a spec"
>
> **🟢 GPT —** "a CC0 spec under an AGPL server is an open invitation to a proprietary reimplementation"

⚠ **What is missing:** 🔵 Gemini and ⚫ Grok hold no position on this question, and the stakes are `high` — a convening that would not have concluded even at full strength returned neither a synthesis nor its open questions.

## § SYNTHESIS

```diff
- synthesis  aborted; actual spend $0.1518 reached the $0.1500 cap
- dissent    never adjudicated by any synthesizer
+ positions  2 of 4 kept verbatim, and written to the ledger
```

Re-convene with `budget_usd: 0.30` to seat the same council with synthesis headroom.

---

`adjourned over cap` · **$0.1518** actual (est. $0.1417) · 58.3 s

🟥🟥🟥🟥🟥🟥🟥🟥🟥🟥 101% of the $0.1500 cap — synthesis refused ✗

`ledger` → `ledger/2026-08-07-0918-should-the-ledger-format-ship-cc0-while-the-ser.md`
````

---

## What is theming, and what is a contract change

Phase 4 moved the line since the first draft: the degraded state this theme was
designed around is now real, and one of the gaps I flagged has been papered over
rather than closed. What remains:

**Pure presentation** — the data already exists on `CouncilPlan` /
`AdvisorOutcome`, and only `server.ts` changes: the header, the stakes line, the
roll table, every confidence bar, the position blocks, the casualty list in
example C, both budget meters, and the footer. **The whole seat-chip system is
presentation too** — a frozen four-entry map from `AdvisorName` to a chip and a
bar square, applied at render time, with no model or schema involvement.

**One wrinkle in the chip system.** Chips inside DISSENT quotes and synthesis
prose sit in model-authored regions. `server.ts` can chip them with a substitution
over the four known names — `/\b(Claude|GPT|Gemini|Grok)\b/g` — but that also
rewrites names *inside* a verbatim quote, which for a ledger whose whole promise
is verbatim attribution deserves a deliberate decision rather than a regex applied
by reflex. The conservative version substitutes only in the attribution position
(`**Name —**` at the start of a quote line) and leaves quoted bodies untouched.
The concrete failure it prevents: advisors name each other, so a blanket
substitution puts a blue 🔵 chip on the word "Gemini" *inside* Claude's verbatim
quote, coloring one seat's words with another seat's identity.

**Requires the synthesizer to emit a specified shape** — `src/server.ts:144`
passes `result.dissent` through verbatim, so its structure is whatever the model
wrote. `src/council.ts:154-156` currently asks for "a bullet list — one bullet per
point of disagreement," which is why the real ledger
(`ledger/2026-08-06-1947-…md:43`) contains 300-word single bullets. The
`### ⚖ N · <topic>` heading plus `> **Name —** "quote"` blockquote shape has to be
specified there for the theme to have anything to style.

**The synthesis diff block is the sharpest case of this.** A `+ adopts / - rejects`
block is structured data, and the synthesizer produces none — rule (2) asks it to
state adoptions and rejections in prose. To render the block, `synthesisPrompt`
must require a machine-readable verdict per advisor (one line each,
`adopt|reject|partial`, with a short reason) ahead of the prose. Small prompt
change, large rendering win: it is the one place a reader learns in four lines what
the council did with each voice.

**The un-adjudicated state now exists — in two flavors.** `src/council.ts:321-329`
sets `capBreached` and writes *"Synthesis aborted — budget cap breached mid-flight;
no dissent extraction performed"*; `src/council.ts:343-348` does the same for a
synthesizer that times out or throws. Both produce the same reader-facing fact —
positions exist, dissent was never adjudicated — so the `⚖ DISSENT — NOT
ADJUDICATED` band should key off "dissent was not synthesizer-authored" rather than
off `capBreached` alone, and the footer distinguishes *why*. Note that the quotes
shown under that band in example C are excerpted by the renderer from
`outcome.reply.position`, not written by any synthesizer; the block says so in its
own text, and it must keep saying so.

**A reachability finding worth checking before trusting the cap.** The guard fires
when actual spend reaches the cap before synthesis (`council.ts:321`), but the
estimate that sets the floor for `budget_usd` already reserves the full synthesis
call at `MAX_SYNTH_TOKENS`. Since a seat can bill at most twice (one retry) and
`planCouncil` guarantees `budget ≥ advisors_est + synth_est`, a pre-synthesis
breach needs `advisors_est ≥ synth_est`. Against the current catalog that holds
only at high tier — $0.0833 vs $0.0584 — and fails at medium ($0.0421 vs $0.0582)
and low ($0.0123 vs $0.0262). So the shipped guard can only ever fire on
high-tier convenings, which is why example C is high-stakes: at medium or low it
would be fiction. Either that is intended, or the estimator's synthesis reserve is
too generous to leave the guard any room.

**One data-model gap, now papered over.** `positionOf` (`src/server.ts:37-44`)
still flattens error, malformed, and skipped seats to `confidence: 0`. The new
`src/server.ts:138-139` hides the figure for those seats, but by regex-matching
the rendered prose — `/^(ERROR|MALFORMED|Skipped)/` — rather than reading
`outcome.status`. That works today and breaks silently the moment a detail string
changes shape, and it does not help the ledger, which still records `0.00` for a
seat that never spoke. The bar makes the cost of this visible: an all-⬜ bar with
`✗` is honest, a bar rendered from `0.00` is a lie about a model's confidence.

**One proportion problem** — positions here run 40 words; real ones run up to 300.
Four of those put ~1,200 words between the reader and DISSENT, which inverts the
product's priorities no matter how loud the band is. The mitigations already in the
examples are the roll table (the whole split as colored mass, scannable, above the
fold) and the `⚖ 2 dissents` counter in the header line. If that proves
insufficient, moving DISSENT above THE FLOOR is a deviation from the spec's
numbered return order (§2) and should be a deliberate decision, not drift.

## Which constructs survive, and which to avoid

**Safe in both Claude Code and a plain-text client:** ATX headings (`##`), bold,
italic, `-` lists, blockquotes, inline code spans, and `---` rules with a blank
line above and below. Each is either invisible or self-explanatory when
unrendered — `> **🟠 Claude —** "…"` reads correctly as raw text, chip included.

**Diff blocks** are the one construct that buys real color for free: ```` ```diff ````
renders `+` lines green and `-` lines red in Claude Code and most markdown
clients, and degrades to `+`/`-` prefixed plain text everywhere else, which is
still the right reading. Inside a fence you lose bold and every other markdown
affordance, so keep the blocks short, self-contained, and aligned by padding.
Emoji chips still render inside a fence, and alignment survives as long as every
line carries exactly one chip in the same column, because each shifts its line by
the same two columns. The two axes stay legible when they disagree: a red
`- rejects` line carrying a green 🟢 chip reads as "this verdict went against
GPT," which is exactly the intent.

**Emoji width is the main hazard.** Chips and squares are two columns wide, and
`🏛️`/`⚠️` carry variation selectors that render one *or* two columns depending on
the terminal font. Chips are fine inline in prose and headings, where nothing
depends on alignment. Bars and bands are not: a ten-cell emoji bar occupies twenty
columns, so a three-column table row with one in it is already near seventy
columns before the stance text — that is the practical ceiling, and it is why the
stance column here is clipped short. Every bar in these examples is alone on its
line or alone in its cell.

**Two color caveats worth knowing before this ships.** On a dark terminal, ⬜ empty
cells glow and ⬛ filled cells recede, so ⚫ Grok's bar reads roughly inverted — the
numeral beside every bar is the guard against misreading it, which is why no bar
here appears without one. And 🟩 does double duty: it is 🟢 GPT's fill *and* the
healthy-budget fill. The two never share a line and the budget bar always sits
beside a dollar figure, so context separates them — but if that bothers you, the
budget meter is the one bar that can revert to monochrome `▓░` with 🟥 kept for
breach, and nothing else in the theme changes.

**Risky:** tables degrade worst — pipe rows survive as legible noise in plain text
but wrap into confetti in a narrow pane. Multi-line box-drawing frames
(`┌─┐ │ └─┘`) are the one construct to skip outright: they depend on both the
renderer's line-break handling and the pane width, and a broken frame reads as
breakage rather than as plain text. Trailing-two-space hard breaks are invisible
and get stripped by any trim. And the setext trap is real: a literal `---` or `===`
directly beneath a text line becomes a heading, which is why every rule above has
a blank line over it and every band is built from `▓ ▒ █`, never `- =`.

**Recommendation.** Build the theme from headings, bold, blockquotes, one-line
lists, `---` rules, and diff fences, and put every bar and band alone on its own
line or alone in its own cell. Keep the roll table at three columns and accept that
it is the first thing to look bad in a narrow pane; the diff block is the cheapest
color in the output and the most portable, so lean on it for verdicts. That subset
is soft-break-agnostic by construction: no line's meaning depends on whether the
renderer joins it to the next, so the theme needs no answer to how a particular
client treats a single newline. Cap decorative bands at 48 columns — tool results
render in a narrowed, prefixed pane, and a wrapped band leaves an orphan row of
blocks that looks like a bug rather than a flourish.
