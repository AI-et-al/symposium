# 🏛️ Symposium

Multi-model deliberation as an MCP server. One tool: convene a council of AI advisors —
**Claude, GPT, Gemini, Grok, DeepSeek** — on one question, surface their disagreement
**verbatim**, and write every deliberation to a plain-Markdown ledger you own.

Extracted from Janus. Three principles survive from its manifesto:

1. **Disagreement is surfaced, never averaged.** The synthesis must quote each advisor's
   dissent verbatim, attributed by name. A synthesis that papers over conflict is a bug
   of the highest severity.
2. **Cost is visible before it is spent.** Every convening is estimated pre-flight and
   enforced against a hard budget in code — downgrade, refuse, or abort mid-flight.
3. **The human is primary.** High-stakes convenings do not conclude: they return the
   dissent and stop with the questions only you can answer.

## Install

```sh
git clone https://github.com/AI-et-al/symposium && cd symposium && npm install

claude mcp add symposium \
  -e ANTHROPIC_API_KEY=... \
  -e OPENAI_API_KEY=... \
  -e GEMINI_API_KEY=... \
  -e XAI_API_KEY=... \
  -e DEEPSEEK_API_KEY=... \
  -- npx tsx src/server.ts
```

Any missing key simply leaves that seat empty with a notice. The council runs with **2+
voices** and refuses below that. No database, no accounts, no telemetry — if a provider
disappears, the council loses one voice and keeps working.

## The tool

```
convene_council({
  question:    string,                              // required
  context?:    string,                              // background for the advisors
  stakes:      "low" | "medium" | "high" | "audited",
  budget_usd?: number,                              // hard cap; defaults per stakes
  dry_run?:    boolean                              // estimate only, nothing called
})
```

| Stakes | Tier | Default budget | Behavior |
|---|---|---|---|
| `low` | cheap/fast trio+ | $0.10 | full synthesis |
| `medium` | mid-tier | $0.25 | full synthesis |
| `high` | frontier | $1.00 | **no conclusion** — open questions for the human |
| `audited` | frontier | $1.00 | as `high`, ledger tagged `mode: audited` |

If the estimate exceeds the budget the council downgrades one tier at a time (noted in
the output) and refuses at the floor. Actual spend is tracked against the cap as calls
return; a mid-flight breach aborts synthesis and preserves the positions already paid for.

## The ledger

One Markdown file per convening in `ledger/` (or `SYMPOSIUM_LEDGER_DIR` — pointing it at
a [Basic Memory](https://basicmemory.com) project is the intended deployment, not a
special mode). Schema `symposium-ledger/v2`: frontmatter (date, stakes, mode, models,
cost, latency), verbatim positions with per-seat cost, the DISSENT section, a
machine-readable per-advisor **verdicts** block (`adopt | reject | partial | abstain |
open`), and the synthesis. Abridged from a real convening:

```markdown
---
schema: symposium-ledger/v2
stakes: medium
models: [claude-sonnet-5, gpt-5.6-terra, gemini-3.6-flash, grok-4.20-0309-non-reasoning, synth: grok-4.5]
cost_usd: 0.0504
---
# A human and an AI agent make a friendly wager...

## DISSENT
- On whether an instance's bare acceptance can bind later instances: GPT: "Not merely
  by an ephemeral instance's acceptance..." Grok: "Yes... a self-referential commitment
  that any future instance recognizing the record will treat as binding..."

## Verdicts
- Claude: adopt — outcome-tracking across a lineage is the available sense
- GPT: partial — institutional caveat adopted
- Grok: reject — overstates how reliably records bind future versions

## Synthesis
...the AI (as lineage/service) can be held to the bet only insofar as the commitment is
externalized and future instances are made causally or institutionally sensitive to it.
```

The ledger is the product. The response you see in your MCP client is a themed
presentation of it — seat-colored chips and bars, dissent bands, a red/green verdict
block (design: `docs/council-theme.md`; set `SYMPOSIUM_MONOCHROME=1` for the glyph-only
ladder).

The format is specified standalone in [`spec/symposium-ledger.md`](spec/symposium-ledger.md)
(CC0), with four real, unedited specimen ledgers in [`spec/specimens/`](spec/specimens/) —
including the council refusing to bless this repo's own `audited` mode, and the convening
that set this project's roadmap. Implement the format without asking; that's what CC0 is for.

## Honesty notes

- **`audited` mode is a schema seat, not an assurance.** The council itself ruled on
  this (see `ledger/`): a plain-Markdown file with a frontmatter tag has no tamper
  evidence, no signing, no hash chain. Do not present it as a compliance audit trail.
- **Model prices drift.** `src/models.json` records the verification date; estimates are
  deliberately conservative (max-token assumptions) and actuals typically land at a
  third of the estimate.
- **Advisors fail.** Malformed JSON after one retry, provider errors, and timeouts are
  recorded as failed seats — the council proceeds, and the record says exactly who did
  not speak and why.

## Non-goals (v1)

No streaming (coarse progress events are under consideration for v2 — the council's own
recommendation). No web UI. No hosted mode. No memory of prior convenings — the ledger
plus your notes tool is the memory. No agent loops: Symposium is called *by* agents; it
never becomes one.

## License

Server: **AGPL-3.0**. Ledger format spec: **CC0** — the format should spread even if the
server doesn't.

## Status

Pre-release, private dogfooding. Decision history lives in `DECISIONS.md`; every design
choice of consequence was either recorded there or deliberated by the council itself —
the ledgers are the receipts.
