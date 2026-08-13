# The Symposium Ledger

**A plain-text format for deliberation records** — what happened when several AI models
were convened on one question: who spoke, who disagreed, in whose words, at what cost,
and what remains for the human to decide.

Schema id: `symposium-ledger/v2` · Status: in production use, pre-1.0 · License: **CC0**

This document describes a format we use daily. It is not a standards-body artifact and
does not claim to be one; if the format is useful, take it — CC0 means exactly that.
Focal-point status is earned by adoption, not declared in a README. The reference
implementation is [Symposium](../README.md) (AGPL); the format is dedicated to the
public domain so it can spread without the server.

## Why a deliberation record

Protocols exist for agents *talking* — MCP for tools, A2A for agent-to-agent traffic.
Nothing standardizes the **record of deliberation**: when multiple models weigh in on a
question that matters, the ensemble's disagreement is usually averaged away in the
synthesis, and the human sees only the smoothed conclusion. A deliberation record
inverts that:

1. **Disagreement is surfaced, never averaged.** Dissent is quoted verbatim,
   attributed by name. A record that papers over conflict is malformed.
2. **Every seat is accounted for.** A voice that failed, timed out, or was never
   keyed appears in the record with the reason. Silence is data.
3. **Cost is on the record.** What the deliberation cost, per seat where metering
   allows, so the economics of advice are never invisible.
4. **The human is primary.** At high stakes the record concludes with open questions,
   not a verdict. Some calls belong to people.

## File conventions

- One convening = one file. Plain Markdown, UTF-8, YAML frontmatter.
- Filename: `YYYY-MM-DD-HHMM-<slug>.md` — local time, slug from the question
  (lowercased, non-alphanumerics collapsed to `-`, max 60 chars). On collision,
  append `-2`, `-3`, ….
- **Write-once.** The reference implementation opens with the `wx` flag: a ledger file
  is never overwritten. Immutability is by convention only — see
  [Honesty constraints](#honesty-constraints).
- The ledger directory is wherever the operator says it is (`SYMPOSIUM_LEDGER_DIR`);
  pointing it at a notes system is an intended deployment, not a special mode.

## Frontmatter

```yaml
---
schema: symposium-ledger/v2
date: 2026-08-13T01:14:19.029Z       # ISO 8601, UTC
stakes: medium                        # low | medium | high | audited
mode: standard                        # audited iff stakes == audited, else standard
models: [claude-sonnet-5, gpt-5.6-terra, gemini-3.6-flash, grok-4.20-0309-non-reasoning, synth: grok-4.5]
cost_usd: 0.1020                      # actual total, 4 decimals
latency_ms: 94873                     # wall-clock for the whole convening
---
```

`models` lists advisor model ids in seat order, with the synthesizer last under a
`synth:` prefix. All fields are REQUIRED.

## Sections, in order

### `# <title>`

The question, truncated to 80 characters.

### `## Question`

The full question, followed by any context the convener supplied, verbatim.

### `## Positions`

One block per seat, in seat order:

```markdown
### Claude (claude-sonnet-5) — confidence 0.62 — cost $0.0383
<position body, ≤300 words per the advisor contract>

*Dissent from framing:* <present only if the advisor challenged the question itself>
- Uncertainties: <semicolon-joined list, or "none stated">
- Self-objection: <the advisor's strongest objection to its own position>
```

- `confidence` is the advisor's self-reported 0.00–1.00.
- ` — cost $X.XXXX` is the actual per-seat spend (v2; omit only if unmetered).
- **Failed seats stay in the record.** A seat that returned unparseable output after
  one retry gets body `MALFORMED: <reason>`; a seat that never ran gets
  `Skipped: <reason>` (no key, timeout, provider error). Failed seats carry
  `confidence 0.00` and their *actual* cost — a malformed reply that billed $0.0331
  is recorded as having billed $0.0331. The record says exactly who did not speak
  and why. A record that silently drops a convened seat does not conform.

### `## DISSENT`

The points of material disagreement. Each point names the axis of dispute and quotes
each dissenting advisor **verbatim**, attributed by name. Paraphrase does not conform:
the whole point of the section is that a reader can check the synthesis against the
advisors' actual words. Formatting (list items vs. `###` subsections with
blockquotes) is unconstrained; verbatim attribution is not.

### `## Verdicts`

Machine-readable per-advisor stance toward the synthesis, one line each:

```markdown
- Claude: adopt — spec+essay as joint first motion; norm over project survival
- GPT: partial — adopt privacy corrections; reject c-first sequencing
- Gemini: abstain — malformed, no position
- Grok: partial — adopt narrative primacy; reject ranking b above c
```

Vocabulary: `adopt | reject | partial | abstain | open`. Advisors whose seat failed
are recorded as `abstain`. If synthesis never ran, the section body is
`*None — synthesis did not run.*`

### `## Synthesis`

At `low`/`medium` stakes: a synthesis that **names what it adopts and rejects from
each position, and why**, quoting the dissent it resolves. A synthesis that merely
summarizes agreement is not a synthesis of a deliberation.

At `high`/`audited` stakes: **no conclusion.** The section records the unresolved
tension and ends with numbered questions only the human can answer. This is not a
degraded output; it is the format working as designed — see specimen
[the audited-mode ruling](specimens/2026-08-10-1351-does-a-plain-markdown-ledger-with-frontmatter-schema-version.md),
where the council declined to adjudicate its own product's compliance claim and
returned four questions instead.

### `## Relations`

Wikilink targets (`- relates_to [[slug]]`) so records can be woven into a notes
system. Defaults to the record's own slug.

## Conformance, minimally

An implementation that is not Symposium produces a conforming deliberation record if:

- dissent is quoted verbatim and attributed (MUST);
- every convened seat appears with an outcome — spoke, malformed, skipped, timed out —
  and a reason for silence (MUST);
- costs are recorded where the seats are metered (MUST if metered, per-seat SHOULD);
- verdicts use the five-word vocabulary (SHOULD);
- above the implementation's chosen stakes threshold, the record ends in open
  questions rather than a conclusion (MUST, if the implementation has stakes at all);
- the record is a plain text file the operator owns (MUST).

Everything else — section styling, filename scheme, frontmatter extras — is yours.

## Honesty constraints

**This format is not an audit trail.** A plain-Markdown file with a frontmatter tag
has no tamper evidence, no signing, no hash chain, no access control beyond the
filesystem. The council convened on exactly this question at `audited` stakes and the
record of its refusal to bless the claim is
[specimen 3](specimens/2026-08-10-1351-does-a-plain-markdown-ledger-with-frontmatter-schema-version.md).
`mode: audited` is a schema seat, not an assurance. Do not present these files as
compliance records.

**Redaction is the operator's problem, for now.** Verbatim preservation has privacy,
prompt-injection, and sensitive-data consequences; a durable record of model output
deserves retention and redaction thought the format does not yet prescribe. Treat
this as an open area (see v3 directions).

## Version history

- **v1** — initial format: frontmatter, positions with confidence/uncertainties/
  self-objection, verbatim DISSENT, synthesis, relations.
- **v2** — added per-seat `cost` on position headings and the machine-readable
  `## Verdicts` section. The verdicts requirement was itself deliberated by the
  council before adoption (see `ledger/` in the reference repo, 2026-08-10).

## v3 directions (not yet implemented)

- **Seat provenance.** Seats will declare `retained` (an agent authenticated by a
  human's own subscription, carrying that human's context — informed but interested
  counsel) or `neutral` (a cold API instance). Provenance discloses context and
  incentives; it does not rank seats. The distinction exists because a reader must be
  able to ask whether a dissenting seat speaks from knowledge of its human or from
  independence — the two are different evidence.
- **Redaction markers.** A conforming way to elide sensitive spans without breaking
  the verbatim guarantee for what remains.

## Specimens

Real convenings, unedited, from this repository's own history:

| Specimen | Schema | Shows |
|---|---|---|
| [The strategy convening](specimens/2026-08-12-2014-symposium-is-a-tiny-pre-release-open-source-project-about-to.md) | v2 | Full v2 flow; a degraded council (one seat malformed *and billed*, one seat unkeyed); the synthesis rejecting a seat's ranking using that seat's own self-objection |
| [The wager](specimens/2026-08-10-1348-a-human-and-an-ai-agent-make-a-friendly-wager-if-at-any-poin.md) | v1 | Four voices in genuine philosophical dissent; the DISSENT section carrying an argument no single answer could |
| [The audited-mode ruling](specimens/2026-08-10-1351-does-a-plain-markdown-ledger-with-frontmatter-schema-version.md) | v1 | High-stakes non-conclusion: the council refuses to adjudicate, returns four questions; two frontier seats malformed and recorded as such |
| [The morning question](specimens/2026-08-10-1353-what-single-question-should-an-operator-ask-their-ai-council.md) | v1 | The floor: a low-stakes budget-tier council, $0.0077 and 19 seconds, dissent still structured and attributed |

---

*This specification is dedicated to the public domain under
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). No attribution is
required. If the ideas outlive the name, that counts as success.*
