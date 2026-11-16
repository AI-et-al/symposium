# 🏛️ Symposium

Multi-model deliberation as an MCP server. One tool: convene a council of AI advisors —
**Claude, GPT, Gemini, Grok, DeepSeek, Qwen** (via OpenRouter), plus **retained seats** held by your own
subscription CLIs — on one question, surface their disagreement **verbatim**, and write
every deliberation to a plain-Markdown ledger you own.

Extracted from [Janus](https://github.com/AI-et-al/Janus). Three principles survive
from [its manifesto](https://github.com/AI-et-al/Janus/blob/main/MANIFESTO.md)
(the lineage is chronicled in [docs/janus.md](docs/janus.md)):

1. **Disagreement is surfaced, never averaged.** The synthesis must quote each advisor's
   dissent verbatim, attributed by name. A synthesis that papers over conflict is a bug
   of the highest severity.
2. **Cost is visible before it is spent.** Every convening is estimated pre-flight and
   enforced against a hard budget in code — downgrade, refuse, or abort mid-flight.
3. **The human is primary.** High-stakes convenings do not conclude: they return the
   dissent and stop with the questions only you can answer.

**Kin and credit.** The spec's second principle is named the *Karpathy constraint*
(every step small, bounded, observable; cost shown before it is spent), and this
project is gladly indebted to Andrej Karpathy's
[llm-council](https://github.com/karpathy/llm-council): several models on one
question, each reviewing the others' anonymized answers, a designated Chairman
compiling the best of them into one final response. It's cool. It's also, by
design, a machine for producing the answer — and watching answers get compiled is
what convinced us the *other* tool should exist. Symposium is the deliberate
inverse: advisors answer blind and never see each other, the synthesis must
preserve their disagreement verbatim, and at high stakes there is no answer at
all — the record is the product, with budgets enforced in code and a ledger file
the human owns. [Janus](https://github.com/AI-et-al/Janus), this project's parent,
had already named its incremental rule the *Karpathy Principle* — the debt is in
the name, and if the inverse turns out to be valuable, much of the credit belongs
upstream.

## Install

**One key seats the full council.** With just an OpenRouter key, every voice that
lacks its own key sits via OpenRouter — same models, slug-prefixed ids naming what is
billed, disclosed in every record:

```sh
git clone https://github.com/AI-et-al/symposium && cd symposium && npm install

claude mcp add symposium \
  -e OPENROUTER_API_KEY=... \
  -- npx tsx src/server.ts
```

Native keys, when you have them, always outrank the fallback for their own voice —
add any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`,
`DEEPSEEK_API_KEY` and that seat goes direct. With no OpenRouter key at all, only
natively-keyed seats sit. Any missing seat is simply empty with a notice; the council
runs with **2+ voices** and refuses below that. No database, no accounts, no
telemetry — if a provider disappears, the council loses one voice and keeps working.

> ⚠ If your OpenRouter account restricts **Allowed Providers** (Settings → Privacy),
> each seated voice's upstream must be on the allowlist or its calls 404 — recorded
> honestly as a failed seat, but avoidable.

Or skip the clone entirely once you have keys in hand — the package publishes as
[`symposium-mcp`](https://www.npmjs.com/package/symposium-mcp) (plain `symposium`
was already taken on the registry; the server and its one tool keep their name):

```sh
claude mcp add symposium -e OPENROUTER_API_KEY=... -- npx -y symposium-mcp
```

Long convenings report **coarse progress** (each seat as it speaks, synthesis, the
ledger write) to MCP clients that request it; the result and the ledger stay atomic.

## Retained seats (v0.7)

Your own subscription CLIs can hold council seats alongside the cold API voices.
Opt in explicitly — a subscription CLI is never invoked unasked:

```sh
claude mcp add symposium \
  -e SYMPOSIUM_RETAINED_SEATS=claude,codex,agy \
  ... \
  -- npx tsx src/server.ts
```

That seats **Claude Code** (`claude -p`), **Codex** (`codex exec`), and **Antigravity**
(`agy`) as subprocesses in answer-only mode: read-only/plan/sandbox flags, no MCP
servers or isolated ephemeral workspaces, no session files, carrying your user-level
context and nothing else. A seat whose CLI is not on PATH is simply skipped with a
notice, like a missing API key.

A retained seat is **retained counsel**: it runs under your subscription and may know
your context — informed in ways no neutral seat can match, and interested in ways no
neutral seat is. The ledger marks every seat `retained` or `neutral` (schema v3);
provenance disclosures rank nothing — they let the reader ask whether a dissenting
voice speaks from knowledge of you, or from independence. Seating both your retained
Claude and the neutral API Claude is legitimate and sometimes the most interesting
configuration.

Retained seats bill nothing through the API meter and appear unmetered in the ledger —
but they are **not free**: they consume your subscription quota, run under each
provider's terms of service, and cost you the queue time of your own tools.

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
special mode). Schema `symposium-ledger/v3`: frontmatter (date, stakes, mode, models,
cost, latency), verbatim positions with per-seat provenance and cost, the DISSENT
section, a machine-readable per-advisor **verdicts** block (`adopt | reject | partial |
abstain | open`), and the synthesis. Abridged from a real convening:

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

For agents outside MCP entirely, [`skills/deliberation-records/`](skills/deliberation-records/SKILL.md)
is a CC0 Agent Skill (OpenClaw-compatible) that teaches any agent to write conformant
records natively — no server, no credentials, no network. Its design was itself put to
the council; a retained-only council ruled format-first, and the ledgers are the receipts.

## Honesty notes

- **`audited` mode adds tamper-evident SHA-256 hash chaining, not external signing.** Each
  v0.9+ ledger entry records `prev_sha256` and `content_sha256` (`verifyLedger()` checks
  the chain), which detects accidental or post-hoc edits inside a directory — but anyone
  with write access to the directory could rewrite the chain from genesis. Still not a
  third-party compliance audit trail without external anchoring or signatures.
- **Model prices drift.** `src/models.json` records the verification date; estimates are
  deliberately conservative (max-token assumptions) and actuals typically land at a
  third of the estimate.
- **Advisors fail.** Malformed JSON after one retry, provider errors, and timeouts are
  recorded as failed seats — the council proceeds, and the record says exactly who did
  not speak and why.
- **Retained seats are not free, and answer-only is best-effort.** "No API billing"
  is not "zero cost" (quota, ToS, opportunity cost — the council itself corrected this
  framing). The no-tools containment uses each CLI's own flags (`claude`, `codex`, `agy`),
  verified against the versions recorded in `DECISIONS.md`.

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
