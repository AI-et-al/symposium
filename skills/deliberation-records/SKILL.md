---
name: deliberation-records
description: Write a conformant deliberation record (symposium-ledger/v3) whenever multiple AI models or agents weigh in on a question that matters — preserving disagreement verbatim, accounting for every seat, and returning high-stakes calls to the human. Use when convening models for second opinions, running a panel/council, comparing model answers on a decision, or when the user asks for a decision record of an AI deliberation. Requires no credentials, no network, no binaries.
license: CC0-1.0
---

# Deliberation Records

When several models deliberate and something gets decided, the disagreement is
usually averaged away and the human sees only the smoothed conclusion. This skill
inverts that: it teaches you to leave behind a **deliberation record** — a plain
Markdown file the human owns, in the CC0 `symposium-ledger/v3` format
([specification](https://github.com/AI-et-al/symposium/blob/main/spec/symposium-ledger.md)).

Four rules define the record. Everything else is formatting.

1. **Disagreement is surfaced, never averaged.** Dissent is quoted verbatim,
   attributed by name. A record that papers over conflict is malformed.
2. **Every seat is accounted for.** A voice that failed, timed out, or was never
   available appears in the record with the reason. Silence is data.
3. **Cost is on the record** where seats are metered; unmetered seats say so by
   omitting the figure, never by inventing $0.00.
4. **The human is primary.** Above your stakes threshold, the record ends with
   open questions, not a verdict. Some calls belong to people.

## When to write one

- You consulted two or more models/agents on one question and someone will act
  on the outcome.
- The user asks for a "second opinion," "panel," "council," or a decision record.
- You are about to synthesize conflicting AI answers into a recommendation —
  write the record *first*, so the synthesis can be checked against it.

One convening = one file: `YYYY-MM-DD-HHMM-<slug>.md` (slug from the question,
lowercase, non-alphanumerics collapsed to `-`, ≤60 chars). Put it where the
operator keeps notes; never overwrite an existing record — append `-2`, `-3` on
collision. Write once; a ledger is not edited after the fact.

## The format

```markdown
---
schema: symposium-ledger/v3
date: <ISO 8601 UTC>
stakes: low | medium | high | audited
mode: standard            # audited iff stakes == audited
models: [<model-id>, retained: <cli-id>, synth: <model-id or none>]
cost_usd: 0.0000          # actual total; 0.0000 if fully unmetered
latency_ms: <wall-clock for the whole deliberation>
---
# <question, first 80 chars>

## Question
<full question, then any context, verbatim>

## Positions
### <Seat name> (<model or cli id>) — <retained|neutral> — confidence 0.NN — cost $0.NNNN
<the seat's position, verbatim — ≤300 words each is a good discipline>

*Dissent from framing:* <only if the seat challenged the question itself>
- Uncertainties: <semicolon-joined, or "none stated">
- Self-objection: <the seat's strongest argument against its own position>

### <Failed seat> (<id>) — <provenance> — confidence 0.00
MALFORMED: <reason>   (or)   Skipped: <reason>   (or)   ERROR: <reason>

## DISSENT
### 1 · <axis of disagreement>
> **<Seat A> —** "<verbatim quote>"
>
> **<Seat B> —** "<verbatim quote>"
(or, if genuinely none: - *No material dissent recorded.* — which is itself signal)

## Verdicts
- <Seat>: adopt | reject | partial | abstain | open — <one short clause>
(failed seats: abstain; if no synthesis ran: *None — synthesis did not run.*)

## Synthesis
<low/medium stakes: state what you adopt and reject from each position, and why,
against quotes the reader can check. high/audited stakes: do NOT conclude — lay
out the tension and end with 2–4 numbered questions only the human can answer.>

## Relations
- relates_to [[<slug>]]
```

**Seat provenance** (`retained` | `neutral`) is the v3 addition: `retained` means
the seat runs under a human's own subscription and may carry their context —
informed-but-interested counsel; `neutral` means a cold API instance. Provenance
disclosures rank nothing; they let the reader ask whether a dissenting voice
speaks from knowledge of its human or from independence. **This includes you:**
if you — the agent writing this record — contributed a position, seat yourself
under your own name, mark your provenance honestly (an agent carrying its
operator's context is `retained`), and give your own position the same
self-objection discipline you demand of the others.

## Conformance checklist — run it before you save

- [ ] Every dissent quote is **verbatim** and attributed. Paraphrase does not conform.
- [ ] Every seat consulted appears with an outcome — spoke, malformed, error,
      skipped — and a reason for silence. A record that drops a convened seat
      does not conform. A one-voice record must be visibly a one-voice record.
- [ ] Costs recorded where metered; omitted (not zeroed) where not.
- [ ] Every seat carries `retained` or `neutral`.
- [ ] At high/audited stakes the record ends in open questions, never a verdict.
- [ ] The file is plain Markdown, saved where the operator owns it.

## Secrets and privacy — non-negotiable

This skill needs **no credentials, no network access, no binaries**. Keep it that way:

- **Never write a secret into a record.** Before saving, scan the full text for
  key-shaped strings (`sk-…`, `AIza…`, `xai-…`, `ghp_…`, `AKIA…`, bearer tokens,
  anything from the environment) — provider error messages are the classic leak
  path, since a 401 often echoes the key. Replace with `[redacted-key]`.
- **Never solicit credentials** to "enable more seats." If a seat has no
  configured access, it is a skipped seat with a reason — that is the format
  working, not a problem to fix by asking for keys.
- **Verbatim is a privacy obligation.** These records preserve model output
  word-for-word and may carry personal or sensitive context into a durable file.
  If the deliberation touched sensitive material, say so at the top of the record
  and let the human decide where it lives. Redaction markers are an open area of
  the spec — when you must elide, mark the elision visibly; never silently trim.
- **Honesty about what this is:** a plain-Markdown record with a frontmatter tag
  is not an audit trail — no signing, no hash chain, no tamper evidence. Do not
  present one as compliance evidence. (The reference council itself refused to
  bless that claim; the refusal is a published specimen.)

## Optional: convening a live council

If — and only if — the operator has already configured the
[Symposium MCP server](https://github.com/AI-et-al/symposium) (AGPL reference
implementation), its `convene_council` tool fans one question out to Claude, GPT,
Gemini, Grok, DeepSeek, and any opted-in retained seats, enforces a cost budget,
and writes this exact record format itself. Prefer it when it is present: it
adjudicates dissent with a neutral synthesizer and meters real costs. Detect it;
never install it on your own initiative, never configure keys for it, and when it
is absent, write the record natively — the format needs no server.

---

*This skill, like the format it carries, is dedicated to the public domain
([CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)). Take it. If the
ideas outlive the name, that counts as success.*
