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

## 2026-08-06 — Synthesis budget raised after first live convening truncated mid-DISSENT

The P3 gate convening's synthesizer (gemini-3.1-pro-preview, a thinking model) spent most
of the 2048-token synthesis budget on internal reasoning and truncated ~90 visible tokens
into the DISSENT section (caught loudly by the format-failure guard). `MAX_SYNTH_TOKENS`
2048 → 8192 to give frontier synth models thinking headroom; the low-stakes default
budget rises $0.05 → $0.10 so the floor tier still clears its own estimate.

## 2026-08-06 — Grok seated as the fourth council voice (spec §2 amended)

Dan's direction: extensibility was the point ("making sure I could add more models" — the
Janus impulse). The council is now four voices — Claude, GPT, Gemini, Grok — and the spec's
"three-model" phrasing is amended to N-voice with the ≥2 rule unchanged.

- xAI catalog verified 2026-08-06 against docs.x.ai: `grok-build-0.1` $1/$2 (low),
  `grok-4.20-0309-non-reasoning` $1.25/$2.50 (medium), `grok-4.5` $2/$6 (high). Base-tier
  rates recorded; xAI charges more above 200k prompt tokens, far beyond council prompts.
  The non-reasoning mid model is deliberate: the JSON contract needs no thinking tax.
- Adapter reuses the OpenAI SDK against `https://api.x.ai/v1` (chat completions,
  `max_completion_tokens`) — no new dependency, per docs.x.ai's own recommendation.
- Env key: `XAI_API_KEY`. Missing key = Grok skipped with a notice, same as any seat.
- Side effect worth knowing: Grok's cheap output pricing makes xai models the default
  synthesizer pick at every tier (cheapest synth-call cost among available providers).

## 2026-08-06 — Phase 4 (hardening): design decisions

- **Timeouts** — 60s per advisor call (spec §5), applied separately to the first call and
  the retry; synthesis gets 120s (it reads N positions and thinks before writing). A
  timeout surfaces as an `error` outcome / loud synthesis-failure marker, never a hang.
- **Mid-flight cost abort under parallel fan-out** — all advisors launch simultaneously,
  so "abort remaining calls" (spec §3) concretely means: once actual spend reaches the
  cap, retries are skipped and synthesis is aborted; advisor positions already returned
  are kept and recorded. Full AbortController plumbing into in-flight HTTP calls is
  deliberately out of scope — per-call spend is bounded by max-token ceilings.
- **Synthesizer failure isolation** — a synth timeout/error no longer sinks the
  convening: positions are preserved, dissent/synthesis carry a loud failure marker.
- **Secret redaction** — provider error messages can echo credentials (OpenAI 401s quote
  a masked key). `redactSecrets` scrubs key-shaped strings from all failure details
  before they reach the response or ledger. Word boundaries + length floors added after
  the first sweep false-positived on "risk-tolerant" in real advisor prose. One
  historical ledger entry containing OpenAI's own masked fragment of an already-rotated
  key was scrubbed in place.

## 2026-08-10 — Phase 4 gate observations (ten assorted convenings)

Ten real convenings across all four stakes levels, ~$0.44 total, every ledger written,
secret sweep clean. Two findings worth acting on later:

- **High-tier advisors malform more.** Gemini 3.1 Pro malformed in two convenings and
  Claude Opus 5 in one — frontier models (especially Gemini, which we cannot easily
  de-think) burn advisor output budget on reasoning and truncate the JSON contract at
  1024 tokens. The contract's malformed-handling absorbed every case gracefully, but
  raising `MAX_ADVISOR_TOKENS` for the high tier (or per-model output floors) is the
  obvious P5/v2 fix. Low/medium tiers malformed zero times across the ten.
- **The council itself says `audited` mode overstates assurance.** The audited-stakes
  convening on audit-trail sufficiency returned a two-voice verdict that a plain-Markdown
  ledger with a frontmatter tag is not an audit trail (no tamper evidence, no signing,
  no hash chain). v2 candidates: hash-chained entries, per-seat cost in frontmatter,
  signed ledgers. Until then the README must not oversell `audited`.

Stakes/tier decoupling, the downgrade note, the high-stakes stop-for-human path, and
mid-flight cost accounting all behaved to spec in production.

## 2026-08-10 — v0.6.0: council v2 (verdicts, per-tier budgets, DeepSeek, theme, README)

Dan's directive: "proceed with your recommended fixes across all areas." Shipped together:

- **Per-tier advisor token budgets** — `ADVISOR_TOKENS` low 1024 / medium 2048 / high
  4096, replacing the flat 1024. Fixes the P4 gate finding (frontier models spend output
  tokens on reasoning we can't disable and truncate the JSON contract). Estimates scale
  accordingly.
- **Ledger schema v2** — implements the council's own 2026-08-10 recommendation: a
  required machine-readable `## Verdicts` block (adopt/reject/partial/abstain/open, one
  line per advisor, structured block authoritative for rendering, prose stays narrative),
  plus per-seat cost in positions. The synthesis prompt now specifies the three-section
  shape (DISSENT topics with attributed blockquotes, VERDICTS lines, SYNTHESIS/OPEN
  QUESTIONS); parsing is tolerant — a missing VERDICTS section degrades to `unspecified`,
  never a failure.
- **DeepSeek seated as the fifth voice** — per the council's unanimous choice and its
  native-adapter-first synthesis. Catalog verified 2026-08-10 (deepseek.ai/pricing,
  benchlm.ai, openrouter.ai): `deepseek-v4-flash` $0.14/$0.28 (low), `deepseek-v4-pro`
  $0.435/$0.87 (medium AND high — two tiers, one model; DeepSeek ships two models).
  OpenAI-compatible at api.deepseek.com via the existing SDK; env `DEEPSEEK_API_KEY`
  (seat skips until a key exists). Side effect: DeepSeek's pricing makes it the default
  synthesizer at every tier once keyed. OpenRouter trial channel remains the next step
  for seats 6+ per the staged-admission policy.
- **Themed response (the chamber)** — the response text now renders per
  `docs/council-theme.md`: seat chips (🟠🟢🔵⚫🟣) on every mention, seat-colored
  confidence bars, dissent bands, a red/green ```diff verdict block, degraded-council
  and NOT-ADJUDICATED states, and a budget meter. Deviation from spec §2's numbered
  return format — the ledger remains the structured record; the response is
  presentation. Chips are applied to dissent attribution lines only, never inside
  quoted bodies (one seat's words must not carry another seat's color).
  `SYMPOSIUM_MONOCHROME=1` degrades to the glyph ladder.
- **README written** — last, per spec §5 P5, with the audited-mode honesty note the
  council's own verdict demanded.

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

## 2026-08-12 — The post-oracle pivot: retained seats, and the wave plan

Dan's directive: "do exactly what Peter does that allows him to offer oracle to as
wide an audience as it does." The arc of the deliberation, recorded because it
reversed twice before landing:

1. **Oracle-as-engine considered** — shell out to `@steipete/oracle` for
   ChatGPT/Gemini seats via browser-session auth (his infra as our means; his npm/npx
   distribution as the model). Approved, then **rejected** on reflection: it bets the
   audience story on a ToS-gray scraping arbitrage one provider decision away from
   closing, and imports a single maintainer's side project as a load-bearing wall.
2. **What survived from "what Peter does":** the *bet*, not the trench coat — that
   everyone's existing subscription is the distribution channel. The industry
   confirmed the bet in the interim (Steinberger hired by OpenAI 2026-02-14;
   OpenClaw to a foundation; every major provider now ships a
   subscription-authenticated scriptable CLI).
3. **v0.7 direction adopted: retained seats.** Council seats held by official CLIs —
   `claude -p`, `codex exec`, `gemini` — invoked as subprocesses in answer-only mode
   (no tools, no file access), no API billing (NOT "zero marginal cost" — see council
   correction below), on a new flat tier in the router. Seat provenance
   (`retained` = subscription CLI carrying its human's context, informed-but-
   interested counsel; `neutral` = cold API seat) enters the ledger schema in v3.
   Spec principle 4 will be amended from "no plan-auth tricks" to "first-party auth
   only, no scraping" when v0.7 lands. Oracle remains possible later behind the same
   subprocess abstraction; nothing depends on it.

The strategy itself was put to the council (medium stakes, $0.1020, 3 of 5 voices —
the ledger is `ledger/2026-08-12-2014-…` and now also specimen 1 in `spec/`). Its
sequencing, adopted: **Motion 1** spec + essay as one artifact; **Motion 2** v0.7
retained seats + npm one-line install; **Motion 3** OpenClaw skill, last, only
carrying a citable norm and a hardened secrets story into that trust-crisis
marketplace. Framing corrections adopted from the council, verbatim in the ledger:
"zero marginal cost" is economically misleading (quotas, ToS, opportunity cost);
retained seats are informed-but-interested counsel, not inferior jurors — provenance
discloses, it does not rank; a solo project cannot declare "THE standard," only earn
focal-point status; verbatim ledgers need a redaction/retention posture (open area,
noted in spec). Also adopted, from Claude's dissent-from-framing: optimize for norm
success over project survival — absorption of the format without attribution counts
as success. CC0 was chosen for exactly this, before we knew it.

## 2026-08-15 — Motion 2 executed: v0.7 retained seats + npm packaging

Design decisions, in the order they bit:

- **Opt-in only** — `SYMPOSIUM_RETAINED_SEATS=claude,codex,gemini`. A subscription
  CLI is never probed, let alone invoked, without its token in that list: it burns
  the operator's quota and carries their context into a durable record, so silence
  is the only acceptable default. Unknown tokens are warned about at startup and in
  plan notices, never silently dropped. Opted-in seats whose binary is not on PATH
  skip with a notice, exactly like a missing API key.
- **Seat names are the CLI products** — "Claude Code", "Codex", "Gemini CLI" — not
  "Claude (retained)". The CLI carrying its human's config *is* the counsel entity;
  parenthesized names would also have complicated the verdict-line regex. The chip
  substitution and verdict parsing sort names longest-first so "Claude Code" never
  half-matches as "Claude" (pinned in test/theme.test.ts and council tests).
- **Retained + neutral same-lineage seats may coexist** — seating your retained
  Claude beside the neutral API Claude is legitimate and sometimes the interesting
  configuration (informed-vs-independent, same lineage). No dedup rule.
- **Flat $0 in the router; unmetered in the ledger** — retained seats add nothing to
  the estimate, never downgrade, and cannot breach the cap. Per the council's own
  2026-08-12 correction, "no API billing" is NOT "zero marginal cost" (quota, ToS,
  opportunity cost) — so the ledger omits the cost figure for retained seats rather
  than recording a fictitious $0.0000, and the README says why.
- **The synthesizer stays neutral** — adjudication of dissent is not delegated to an
  interested seat in v0.7. A council of only retained seats (no API keys) still
  convenes if it has quorum, but lands in the existing NOT-ADJUDICATED state: the
  reader is the synthesizer. Revisit only with a deliberate decision.
- **Answer-only mode, per CLI, verified where possible** — claude 2.1.223:
  `-p --output-format text --setting-sources user --strict-mcp-config
  --no-session-persistence --disallowedTools <all builtins>`; codex-cli 0.147.0:
  `exec --sandbox read-only --skip-git-repo-check --ephemeral --color never -C ~
  -o <tmpfile> -` (stdout is a transcript; the clean final message comes via `-o`).
  Gemini CLI: no local install existed at build time — bare stdin one-shot,
  docs-derived, marked unverified; flag drift surfaces as a recorded error outcome.
  Containment is best-effort by each CLI's own flags: these are the operator's own
  tools under their own account, so the posture is answer-only discipline, not a
  security boundary against the operator.
- **Subprocess hygiene** — prompt on stdin (no shell, no ARG_MAX, no ps leakage),
  cwd = home directory (user-level context loads; the MCP client's arbitrary cwd
  does not leak project context into a seat), child SIGKILLed on timeout so no
  subprocess outlives its convening.
- **Retained timeout 180s** (vs 60s API advisors) — CLIs pay spawn + auth + queue
  overhead an API call does not, and parallel fan-out makes tail latency nearly
  free. Both live seats, asked about their own timeout in the v0.7 smoke
  convenings, independently counseled generosity and treating a timeout as a
  recorded failure rather than a retry — which is what the existing error path does.
- **Ledger schema v3** — provenance token (`retained | neutral`) on every position
  heading, and a `retained:` prefix in the frontmatter models list mirroring the
  existing `synth:` idiom. Spec principle 4 amended as the 2026-08-12 record
  promised: "first-party auth only, no scraping." The CC0 spec's v3-directions
  section became the specified v3; redaction markers remain the open area.
- **Theme: hearts for retained seats** — 🧡💚💙 keep the provider hue, swap circle
  for heart (a seat that belongs to someone). Identity=hue, provenance=shape,
  status=marks: three separate axes. Presentation helpers extracted to src/theme.ts
  so the chip rules are finally unit-testable.
- **npm packaging, publication still gated** — `bin: symposium → dist/server.js`
  (tsc build via tsconfig.build.json, shebang preserved, models.json copied into
  dist), `files` allowlist ships dist/src/spec/docs only — no essays (unpublished
  by rule), no ledger records, no .env; verified via `npm pack --dry-run`.
  `prepublishOnly` gates on typecheck+tests. Remaining before `npm publish`, per
  the 2026-08-10 npm convening: Dan's sign-off, and the "did the tool change a
  real decision" question that convening said gates announcement.

## 2026-08-15 — v0.7 gate: retained-only council convened, one manifesto-class bug found

The gate convening was a council of retained counsel alone — Claude Code and Codex,
no API keys, quorum 2, $0.0000 — on a real pending decision (Motion 3's design).
Both seats spoke; the machinery held: v3 provenance throughout, unmetered seats,
36s wall-clock, `retained:` frontmatter. Two findings:

- **Bug, fixed same hour:** with positions but no neutral synthesizer, the DISSENT
  section claimed "every advisor failed" while two seats had spoken — a record
  lying about who spoke. Unreachable before v0.7 (no synth implied no quorum);
  reachable the moment a retained-only council existed, and hit on the first live
  run. The state now says: no synthesizer available, positions preserved, the
  reader is the synthesizer. Regression-tested. Both ledgers kept — the flawed
  record is the receipt of the find (`ledger/2026-08-15-1509-…`), the clean one
  the gate record (`ledger/2026-08-15-1511-…`).
- **Retained context is visible in the record, as designed:** Codex's position
  says "Operator-specific knowledge reinforces this judgment"; Claude Code's
  discloses "my retained context has no Symposium-specific record." The
  provenance norm is doing its work — the reader can see which counsel is
  interested, and how.

## 2026-08-15 — Motion 3 executed: OpenClaw skill, format-first, per the retained council's own ruling

The design question — teach agents to *write* conformant records (format-first) or
to *call* `convene_council` (tool-first) — was put to the v0.7 retained council.
Both seats ruled format-first, decisively (0.86 / 0.94), on three converging
grounds: the norm-over-survival precedent makes the CC0 record the payload, not
the AGPL server; in a marketplace where 7.1% of skills mishandle secrets, **a
skill that requires zero credentials is the hardened secrets story** — nothing to
leak, nothing to phish; and tool-first would quietly amend an adopted motion.
Adopted from the seats' own refinements: the tool appears only as an optional,
capability-detected escalation with keys never assumed; the skill embeds a
deterministic conformance checklist so native records don't drift; redaction
rules and a refusal-to-embed-secrets clause ride along; and an agent writing a
record of its own deliberation marks its own seat's provenance.

- `skills/deliberation-records/SKILL.md` — Agent Skills format (OpenClaw-
  compatible), self-contained, zero credentials, zero network, zero binaries.
  **CC0**, same logic as Motion 1: the skill is a vehicle for the format, and the
  format should spread even if the server doesn't.
- Publication to ClawHub is an outward-facing act and remains the operator's,
  same rule as npm publish and the essay. The artifact is ready; the receipts
  are the two 2026-08-15 ledgers.
- Honest limit, recorded: both seats flagged the same open risk — natively
  written records can be *format*-conformant while "ledger-washing" a
  single-model answer into deliberation costume. The skill's checklist requires
  naming every seat and its outcome, which makes a one-voice record visibly a
  one-voice record; deeper authenticity guarantees are a future-spec problem,
  not a skill problem.

## 2026-08-12 — Motion 1 executed: ledger spec extracted, specimens, essay

- `spec/symposium-ledger.md` — the v2 format as `ledger.ts` actually writes it,
  CC0, with a six-bullet conformance floor for other implementations, honesty
  constraints (not an audit trail; redaction unspecified), and v3 directions
  (seat provenance, redaction markers). Nothing in the spec is aspirational except
  the clearly-marked v3 section.
- `spec/specimens/` — four real convenings, copied unedited from `ledger/` (which
  stays gitignored; specimens are deliberate publications, reviewed before copying):
  the strategy convening (v2, degraded council), the wager (v1), the audited-mode
  ruling (v1, high-stakes non-conclusion), the morning question (v1, $0.0077 floor).
- `essays/your-ai-represents-you.md` — draft in Dan's voice, centerpiece is the
  strategy ledger; publishes nothing until Dan says so.
