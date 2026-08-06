# SYMPOSIUM — Build Specification v1.0

Multi-model deliberation as an MCP server. Extracted from Janus (AI-et-al/Janus).
Core thesis: convene Claude, GPT, and Gemini on one question; surface disagreement
verbatim; write every deliberation to a plain-Markdown ledger the operator owns.

This document is a complete, self-sufficient build spec. It is written to be handed
to Claude Code as the primary instruction file. Human (Dan) reviews at each phase gate.

---

## 0. Non-negotiable principles (from the Janus Manifesto)

1. **Disagreement is surfaced, never averaged.** The synthesis step must quote each
   advisor's dissent verbatim in the output. A synthesis that papers over conflict
   is a bug of the highest severity.
2. **Karpathy constraint.** Every step is small, bounded, observable. Cost is
   estimated and shown BEFORE fan-out. Hard budget cap per convening, enforced in
   code, not in prompts.
3. **The human is primary.** `stakes: "high"` convenings return the dissent table
   and STOP for human judgment; they do not auto-conclude.
4. **Thin and portable.** Standard provider APIs only (API keys, no plan-auth
   tricks). Plain-file ledger. No database. If any single provider disappears,
   the council loses one voice and keeps working.

## 1. Repo setup

- Repo: `AI-et-al/symposium` (public from day one).
- License: **AGPL-3.0** for the server. (Decision made: preserves a future
  hosted/cloud option; MIT forfeits it. Ledger format spec itself is CC0 —
  the format should spread freely even if the server doesn't.)
- Language: TypeScript, Node >= 20. ESM.
- Dependencies (pin exact versions in package.json at install time; do not use ^):
  - `@modelcontextprotocol/sdk` (MCP server, stdio transport)
  - `@anthropic-ai/sdk`
  - `openai`
  - `@google/genai`
  - `zod` (schema validation)
  - dev: `typescript`, `tsx`, `vitest`
- No other runtime dependencies without explicit human approval. Every added
  dependency gets a one-line health justification in DECISIONS.md.

```
symposium/
├── src/
│   ├── server.ts          # MCP entry point, tool registration
│   ├── council.ts         # fan-out, collection, synthesis
│   ├── router.ts          # tier selection, cost estimation, budget enforcement
│   ├── providers/
│   │   ├── types.ts       # Advisor interface
│   │   ├── anthropic.ts
│   │   ├── openai.ts
│   │   └── google.ts
│   ├── ledger.ts          # Markdown writer
│   └── models.json        # model catalog: id, provider, $/Mtok in+out, tier
├── ledger/                # default output dir (configurable, gitignored)
├── test/
├── DECISIONS.md           # decision record, seeded from Janus retirement note
├── README.md              # written LAST (Phase 5), not first
├── LICENSE
├── package.json
└── tsconfig.json
```

## 2. The tool surface (exactly one tool in v1)

```typescript
convene_council({
  question: string,          // required, non-empty
  context?: string,          // optional background pasted by the caller
  stakes: "low" | "medium" | "high" | "audited",
  budget_usd?: number        // default from stakes tier; hard cap regardless
})
```

Returns (MCP text content):
1. Cost estimate line (pre-flight, from router).
2. Per-advisor structured positions.
3. **DISSENT table** — points of disagreement, quoted verbatim per advisor.
4. Synthesis (or, for `high`/`audited`: open questions for the human instead of
   a conclusion).
5. Actual cost + latency + path to the ledger file written.

`audited` in v1 = behaves as `high` plus sets `mode: audited` in ledger
frontmatter. It is a placeholder with a schema seat, per the monetization-path
decision. Do not build more than that.

### Advisor response contract

Each provider is prompted to return STRICT JSON (validated with zod; one retry
on parse failure, then that advisor is recorded as `malformed` and the council
proceeds — a council survives a confused member):

```json
{
  "position": "string — the advisor's answer, <= 300 words",
  "confidence": 0.0,
  "key_uncertainties": ["string"],
  "strongest_objection_to_own_position": "string",
  "dissent_from_framing": "string | null — if the question itself is wrong, say so"
}
```

### Synthesis prompt (core rule, verbatim in code)

> You are the synthesizer for a council of AI advisors. Rules:
> (1) You MUST reproduce each material disagreement between advisors verbatim,
> attributed by advisor name, in a section titled DISSENT. Never average,
> soften, or omit a disagreement.
> (2) Only after the DISSENT section may you offer a synthesis, and it must state
> which advisor positions it adopts and which it rejects, and why.
> (3) If stakes are high or audited, do not conclude: end with the 2–4 questions
> a human must answer to resolve the dissent.

Synthesizer model: the cheapest model in the tier ABOVE the advisors' tier
(synthesis is where subtle flattening happens; spend slightly more there).

## 3. Router (ported from Janus, simplified)

- `models.json` maps stakes → tier → concrete models:
  - `low`: 3 cheap/fast models (e.g., Haiku-class, GPT-mini-class, Flash-class)
  - `medium`: mid-tier trio
  - `high` / `audited`: frontier trio
- Populate models.json with CURRENT model ids and prices at build time —
  Claude Code: verify current model ids and per-token pricing from each
  provider's live docs before writing this file; do not trust training data.
- Cost estimation: (prompt tokens est. + max_tokens per advisor × N advisors
  + synthesis) × price. Shown pre-flight. If estimate > budget: downgrade tier
  automatically and note it in output; if still over at floor tier: refuse
  with the estimate.
- Hard cap enforcement: track actual usage from provider responses; abort
  remaining calls if cap is breached mid-flight (advisors already returned
  are kept and recorded).
- Env: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`. Missing key =
  that advisor is skipped with a notice; council runs with >= 2 advisors,
  refuses with < 2.

## 4. Ledger (the product's soul — treat schema as versioned & stable)

One file per convening: `ledger/YYYY-MM-DD-HHmm-<slug>.md`

```markdown
---
schema: symposium-ledger/v1
date: <ISO 8601>
stakes: medium
mode: standard | audited
models: [<advisor model ids>, synth: <id>]
cost_usd: 0.0000
latency_ms: 0
---
# <question, first 80 chars>

## Question
<full question + context>

## Positions
### <Advisor name (model id)> — confidence 0.xx
<position>
- Uncertainties: ...
- Self-objection: ...

## DISSENT
- **<topic>** — Claude: "<verbatim>" | GPT: "<verbatim>" | Gemini: "<verbatim>"
  (or: *No material dissent recorded.* — which is itself signal)

## Synthesis
<synthesis, or open questions for human if high/audited>

## Relations
- relates_to [[<caller-supplied or slug-derived link>]]
```

Frontmatter + `## Relations` with wikilinks = Basic Memory-compatible. Ledger
directory is configurable via `SYMPOSIUM_LEDGER_DIR`; pointing it at a Basic
Memory project folder is the intended deployment, not a special mode.
NEVER write API keys or env contents into ledger files.

## 5. Phases and gates (one sitting each; STOP at each gate for human review)

- **P1 — Skeleton.** Server + tool registered, hardcoded stub response, ledger
  file written. GATE: `claude mcp add symposium -- npx tsx src/server.ts`
  works; calling the tool from Claude Code produces a stub ledger file.
- **P2 — Router.** Live models.json, cost pre-flight, budget enforcement, unit
  tests for downgrade/refuse paths. GATE: tests green; a dry-run flag prints
  the estimate without calling any provider.
- **P3 — Council.** Three provider adapters, parallel fan-out
  (Promise.allSettled), zod validation, malformed-advisor handling, synthesis
  with the dissent rule. GATE: one real convening on the question "Should
  Symposium's v2 add streaming output?" — human reads the ledger file and
  judges whether dissent survived synthesis. That judgment IS the acceptance
  test.
- **P4 — Hardening.** Timeouts (60s/advisor), partial-council behavior, cost
  abort mid-flight, `stakes: high` stop-for-human path, 10 assorted real
  convenings. GATE: ledger dir reviewed; no leaked secrets; costs match
  provider dashboards within ~10%.
- **P5 — Ship.** README (what/why/install/one honest example ledger file
  inline), register in Claude Desktop as custom connector, announce nowhere
  yet — two weeks of dogfooding on real decisions comes first, per plan.

## 6. Explicit non-goals for v1 (write these into README later)

No streaming. No web UI. No hosted mode. No memory of prior convenings
(the ledger + Basic Memory is the memory). No more than one tool. No agent
loops — Symposium is called BY agents/harnesses; it never becomes one.

## 7. Notes for Claude Code

- Pin every dependency exact-version on install; record versions in DECISIONS.md.
- Verify current model ids/pricing via web docs before writing models.json.
- Conventional Commits. Small commits, one concern each.
- If any part of this spec conflicts with reality (SDK API changes, model
  deprecations), stop and surface the conflict rather than improvising around it.
