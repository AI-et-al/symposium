Janus platform retired, council + router extracted as Symposium, thin-and-portable rationale

---

## 2026-08-06 — Phase 1 (skeleton): dependencies pinned

Runtime (exact pins, per spec §1):

- `@modelcontextprotocol/sdk` 1.30.0 — MCP server + stdio transport; the product's substrate.
- `@anthropic-ai/sdk` 0.115.0 — Claude advisor (wired in Phase 3).
- `openai` 7.4.0 — GPT advisor (wired in Phase 3).
- `@google/genai` 2.16.0 — Gemini advisor (wired in Phase 3).
- `zod` 4.4.3 — tool input schema + advisor response contract validation; also satisfies the MCP SDK's peer range (`^3.25 || ^4.0`).

Dev (exact pins): `typescript` 7.0.2, `tsx` 4.23.9, `vitest` 4.1.10 (per spec §1), plus one addition beyond the spec's list:

- `@types/node` 26.1.2 — dev-only type definitions; required for `tsc --noEmit` over Node builtins (fs/path/url) used by the ledger writer. No runtime footprint.

## 2026-08-06 — Phase 2 (router): model catalog snapshot

`src/models.json` verified 2026-08-06 against live provider docs (per spec §3 — no training-data pricing):

- Anthropic — platform.claude.com models overview: `claude-haiku-4-5` $1/$5, `claude-sonnet-5` $3/$15, `claude-opus-5` $5/$25 per MTok. Sonnet 5 has introductory pricing ($2/$10) through 2026-08-31; the catalog records the sticker price so estimates don't silently shift when the intro lapses (estimates run slightly conservative until then).
- OpenAI — developers.openai.com/api/docs/pricing: `gpt-5.6-luna` $0.20/$1.20, `gpt-5.6-terra` $2/$12, `gpt-5.6-sol` $5/$30.
- Google — ai.google.dev/gemini-api/docs/pricing: `gemini-3.5-flash-lite` $0.30/$2.50, `gemini-3.6-flash` $1.50/$7.50, `gemini-3.1-pro-preview` $2/$12 (≤200k-token rate; council prompts are far below the 200k threshold where Google's long-context pricing kicks in). The 3.1 Pro Preview is Google's current frontier Pro; revisit when a GA Pro ships.

## 2026-08-06 — Phase 2 (router): design decisions

- **`dry_run` tool param** — deviation from spec §2's fixed schema, approved by Dan. The P2 gate's "dry-run flag" lives on the tool (`dry_run?: boolean`) so MCP callers can preview an estimate per-call; env-var and CLI-only alternatives were rejected as unreachable from the tool surface.
- **Synth top-tier clamp** — spec §2 puts the synthesizer one tier above the advisors; at `high` there is no tier above, so the synthesizer is the cheapest `high`-tier model (cheapest by estimated synthesis-call cost, not raw per-token price).
- **Synth requires an available key** — synthesizer candidates are restricted to providers whose API key is set; a synth model we cannot call is not a candidate.
- **Default budget caps** — low $0.05, medium $0.25, high/audited $1.00; explicit `budget_usd` always wins as the hard cap.
- **Token-estimate constants** — chars/4 heuristic; `MAX_ADVISOR_TOKENS` 1024 (≤300-word JSON contract), `MAX_SYNTH_TOKENS` 2048 (DISSENT quotes verbatim), prompt overheads 400/300 tokens. Deliberately crude: the pre-flight estimate guides tier choice; the hard cap is enforced against actual usage (P4).
- **Refusals write no ledger** — a refused convening deliberated nothing; the refusal (with its estimate) is returned as tool text only.
- **Estimates can rise when an advisor is missing** — dropping a provider also drops its synth candidates; losing the cheapest synthesizer can outweigh the saved advisor call. Discovered via test; documented here so nobody "fixes" it.

## 2026-08-06 — Phase 3 (council): design decisions

- **Prompted strict JSON over provider-native structured outputs** — spec §2 prescribes the prompted contract with zod validation, one retry, then `malformed`; the malformed path is the safety net, so no per-provider structured-output machinery. Gemini's native JSON mode (`responseMimeType`) is enabled because it's free to ask; OpenAI/Anthropic rely on the prompt alone.
- **Thinking suppressed on advisor calls** — reasoning tokens bill as output and count against the 1024-token contract budget, which would both truncate replies and break the router's cost model. Anthropic Sonnet 5/Opus 5 get `thinking: {type: "disabled"}` (Haiku omits the param — it predates the disabled type); OpenAI gets `reasoning: {effort: "minimal"}`; Gemini is left at model defaults, with `thoughtsTokenCount` counted as output for actual-cost accounting.
- **Synthesizer output format** — exactly two markdown sections (`## DISSENT`, then `## SYNTHESIS` or `## OPEN QUESTIONS`). A format violation is preserved loudly (`SYNTHESIZER FORMAT FAILURE` marker + full output kept) rather than silently discarded — per the manifesto, buried dissent is the highest-severity bug.
- **Failure accounting** — `malformed`/`error` advisors are recorded in ledger positions with their detail; the synthesizer is told which advisors have no position and not to invent views for them; zero valid positions skips the synth call entirely (no fee for synthesizing nothing).

## 2026-08-06 — Deferred: Oracle (steipete/oracle) as a fourth council member

Dan asked whether adding Oracle as a council voice is expensive. Mechanically no — the
`ProviderAdapter` interface makes any new voice one adapter + four registration touch
points (Provider union, catalog schema, ADVISORS availability row, DEFAULT_ADAPTERS).
Deferred anyway, for spec reasons, not effort:

- Oracle's headline value is ChatGPT/Gemini **browser-session auth** — exactly the
  "plan-auth tricks" principle 4 forbids; in API-key mode it duplicates adapters we
  already have.
- Subscription-backed calls have no $/Mtok, which breaks the router's estimate/budget
  math (would need a "flat/free" tier concept).
- The v2-clean path to more voices is an **OpenRouter adapter**: standard API key,
  per-token pricing that fits the router unchanged, and one adapter buys xAI/DeepSeek/
  Mistral/etc. Revisit after v1 ships.

## 2026-08-06 — Ledger default dir resolves from package root, not cwd

MCP clients launch stdio servers from arbitrary working directories. Defaulting the
ledger dir to `<package root>/ledger` (via `import.meta.url`) keeps writes predictable
no matter where the client was started; `SYMPOSIUM_LEDGER_DIR` still overrides.
