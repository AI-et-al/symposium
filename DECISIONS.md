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

- **`dry_run` tool param** — deviation from spec §2's fixed schema, approved by the operator. The P2 gate's "dry-run flag" lives on the tool (`dry_run?: boolean`) so MCP callers can preview an estimate per-call; env-var and CLI-only alternatives were rejected as unreachable from the tool surface.
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

The operator's direction: extensibility was the point ("making sure I could add more models" — the
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

The operator's directive: "proceed with your recommended fixes across all areas." Shipped together:

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

The operator asked whether adding Oracle as a council voice is expensive. Mechanically no — the
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

The operator's directive: "do exactly what Peter does that allows him to offer oracle to as
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
  the 2026-08-10 npm convening: the operator's sign-off, and the "did the tool change a
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
- `essays/your-ai-represents-you.md` — draft in the operator's voice, centerpiece is the
  strategy ledger; publishes nothing until the operator says so.

## 2026-08-16 — essays/ is local-only; drafts never enter version control

The operator's directive, before first push of the Motion-1-and-later work:
nothing publicly accessible that could come back to bite; peace of mind is the
requirement. Executed: `essays/` excised from the entire unpushed history (it
appeared in exactly one never-pushed commit; ancestors and hashes of pushed
history untouched, fast-forward preserved), the directory gitignored so drafts
cannot re-enter tracking, and the npm `files` allowlist tightened from `docs`
to explicit paths (`docs/janus.md`, `docs/council-theme.md`) so untracked
working files can never ride a tarball — npm packs from the filesystem, not
from git, and a staged announce kit was sitting in `docs/`. Where DECISIONS
entries reference essay drafts, they describe local files by design. Drafts
publish by deliberate copy, the same rule ledger specimens follow.

## 2026-08-16 — Lineage framing settled: indebted to llm-council, the inverse tool, no timeline claims

The operator's directive, verbatim in spirit: remove anything that purports to
claim this tool in any form existed prior to llm-council; instead, say simply
that llm-council was cool, we are indebted to it, and we thought a tool that
provides the inverse has value.

Rationale, recorded because it is a values decision, not a factual one: a
timeline claim — even a true one — is a debate posture. It invites date audits
and frames the project against a person the operator deeply respects. The
indebted-inverse framing has no attack surface: nothing to verify, nothing to
defend, and it is also simply the better story — llm-council compiles the
argument into one best answer; Symposium exists because watching the argument
get compiled away is what makes preserving it look valuable. Swept from the
README credit, `docs/janus.md` (the dates section replaced with "On
llm-council"), this log, and the origins essay draft. Facts are not destroyed
by unclaiming them: the private archive keeps its own history, and nothing in
the public record now makes any assertion about who typed first, in either
direction.

## 2026-08-15 — Janus bridge: lineage linked both ways, priority claim retired

Following the llm-council examination, the same standard applied to our own
history surfaced a problem: the credit paragraph made a timeline claim the
public record cannot support, and this project does not publish claims without
receipts. The claim was removed. *(Superseded next day by the fuller framing
decision below — no temporal claims relative to llm-council in any form.)*

The bridge itself, both directions (items 1 and 2 of the lineage plan; the full
chronicle deferred pending the operator's think):

- Symposium side: README links Janus and its manifesto; `docs/janus.md` maps
  what survived (Disagreement Is Signal → verbatim DISSENT; Show Your Work →
  the advisor contract, nearly field for field; the Karpathy Principle —
  already so named *inside Janus* — → the Karpathy constraint; Honor
  Constraints → human primacy) and what was deliberately left behind (the
  context bridge, the scout/executor swarms, the platform ambition).
- Janus side: a succession note at the top of its README pointing here, with
  the repo kept public as the historical record.

## 2026-08-15 — llm-council examined directly; the kin-and-credit note grounded in observation

The operator asked whether we had ever directly observed what karpathy/llm-council
does, or only credited it from prior model knowledge. We had not — a violation in
spirit of our own verify-against-live-sources rule. Examined 2026-08-15 (README on
`master`, ~24k stars): a local FastAPI/React web app, OpenRouter-only, three
stages — (1) all models answer individually; (2) each model reviews the others'
**anonymized** answers and ranks them by accuracy and insight; (3) a designated
Chairman "compiles them into a single final answer." Conversations stored as local
JSON. No license file, no cost tracking, no stakes, no record format, no MCP.
Karpathy's own framing: "99% vibe coded as a fun Saturday hack," unsupported,
provided for inspiration.

Conclusion, now on the record: not a spinoff relationship in either direction. The
silhouette converges (council, chairman, OpenRouter); the mechanisms are opposite
at the core — llm-council's models cross-examine and its pipeline optimizes for one
best answer; Symposium's advisors answer blind and its pipeline optimizes for the
preserved record, refusing to answer at high stakes. The README credit paragraph
was tightened to say exactly this instead of gesturing at "emphasis." One idea
noted as genuinely theirs and absent here: the anonymized peer-review stage.
Whether advisors should ever see each other's positions is a real future convening,
and it would need to answer the manifesto first (cross-examination pressures
positions toward consensus — the exact failure Symposium exists to resist).

## 2026-08-15 — v0.8.0: the adoption council's gates, executed

The adoption convening (ledger `2026-08-15-1524-…`) ruled niche-yes/mass-no and
named the frictions between try-once and durable use. The operator's directive:
"execute every change this system needs until it would reliably meet all of
council's requirements." Shipped, in order:

- **Synthesizer fallback** — the plan carries synth candidates ranked cheapest-
  first; the council walks the list until one adjudicates, disclosing any
  substitution in the response and recording the seat that actually spoke in the
  ledger frontmatter. Directly heals the recorded DeepSeek-402 trap (keyed but
  unfunded account elected synthesizer, every synthesis failing). All-fail still
  preserves positions loudly, per the P4 isolation rule.
- **Coarse progress events** — the exact shape two councils sanctioned (the v2
  streaming ruling, reaffirmed by the adoption convening): MCP progress
  notifications carrying stage messages — convening, each seat as it speaks or
  fails, synthesis with any fallback, adjournment. Only when the client sends a
  progressToken; never token streaming; result and ledger writes stay atomic; a
  dropped notification never sinks a convening.
- **One key, full council** — the seat-election council's fallback ruling
  implemented: a voice without its native key sits via OpenRouter when
  `OPENROUTER_API_KEY` is set (never for keyed anchors). `models.json` gains
  `openrouter_fallbacks`, fifteen rows verified live against
  `openrouter.ai/api/v1/models` 2026-08-15. Fallback seats are metered into the
  estimate, disclosed with a per-seat notice, and are synth candidates. Observed
  while verifying, flagged for the next full catalog re-check: OpenRouter bills
  `gemini-3.6-flash` at $0.75/$3.75 (half the native catalog's verified price)
  and `claude-sonnet-5` at its $2/$10 intro price — native prices may have
  drifted since 2026-08-10. Operator-side caveat, documented in the README: an
  OpenRouter account with an Allowed Providers allowlist must include each
  seated voice's upstream, or its calls 404 as (honestly recorded) failed seats.
- **README install rewritten around the one-key path**; version 0.8.0.

Deliberately not done, per the same convening's own warnings: no token
streaming, no web UI, no hosted mode, no best-of-n routing, no agent loops.
Mass-no is not failure of the correctness bet; the format and skill chase mass,
the server serves the niche frictionlessly.

## 2026-08-15 — Gate evidence: convenings that changed real decisions

The npm convening's release gate asked whether the tool ever changed an
outcome. The ledgers answer on the record:

- **The roadmap itself** — the strategy convening (`2026-08-12-2014-…`,
  specimen 1) set the three-motion sequencing and reversed the operator's
  "zero marginal cost" framing; both corrections shipped verbatim into spec
  and README.
- **Ledger schema v2** — the verdicts block exists because the council ruled
  it should (`2026-08-10-1343-…`); implemented in v0.6.0.
- **Two seat elections** — DeepSeek (`2026-08-06-1956-…`, `2026-08-10-1345-…`)
  and Qwen (`2026-08-15-1547-…`), both implemented as ruled, including the
  native-first/OpenRouter-fallback architecture this release completes.
- **The audited-mode honesty note** — the council refused to bless its own
  product's compliance claim (`2026-08-10-1351-…`, specimen 3); the README
  says so in its own Honesty notes.
- **Motion 3's shape** — format-first, ruled by a retained-only council
  (`2026-08-15-1511-…`), built as ruled.

The remaining npm-publish gate items are outward acts and belong to the
operator: the publish itself, and any announce.

## 2026-08-15 — Qwen seated as the sixth voice, via the OpenRouter adapter

The operator supplied DeepSeek and OpenRouter keys; per the staged-admission policy,
the council itself chose the sixth seat (ledger:
`2026-08-15-1547-which-model-family-should-fill-the-openrouter-seat-seat-6-of.md`).
Verdict: **Qwen (Alibaba), 4–0** — every speaking voice independently converged on it
for diversity of training lineage, JSON-contract reliability, and price. Honest
record: DeepSeek held a valid key but errored `402 Insufficient Balance`, so the
fifth voice was absent and synthesis failed (DeepSeek was the elected synthesizer);
the four positions stand unadjudicated but unanimous. Known consequence until the
DeepSeek account is funded: the planner still selects DeepSeek as synthesizer
(availability is key-based, not balance-based), so synthesis keeps failing loudly.

- **Adapter** — `src/providers/openrouter.ts`: OpenAI-compatible chat completions at
  `openrouter.ai/api/v1`, env `OPENROUTER_API_KEY`. Sends OpenRouter's unified
  `reasoning: { enabled: false }` — Qwen ships hybrid reasoners, and thinking tokens
  bill as output (the P4 lesson); models without a reasoning mode ignore the param.
- **Catalog** — the Qwen 3.7 generation: the complete flash/plus/max ladder, all 1M
  context, all non-thinking. Verified 2026-08-15 live against
  `openrouter.ai/api/v1/models` (the billing source, not a marketing page):
  `qwen/qwen3.7-flash` $0.03/$0.13 (low), `qwen/qwen3.7-plus` $0.32/$1.28 (medium),
  `qwen/qwen3.7-max` $1.475/$4.425 (high). Qwen 3.8 exists but ships no flash/plus
  tiers yet; `qwen3.6-max-preview` carries a preview tag. The catalog-wide
  `verified` date stays 2026-08-10 — only the Qwen rows were checked today.
- **Seat** — advisor name "Qwen", neutral provenance, chip 🟡/🟨 (originally 🔴/🟥,
  corrected same day: the theme reserves red for a breached budget — "red is never
  decoration" — and a ten-cell confident Qwen bar was visually identical to the
  breach meter). OpenRouter model ids keep their `qwen/` slug prefix in the catalog
  and ledgers: the id names what is billed, and OpenRouter is what bills.

## 2026-11-15 — v0.9.0: hardening pass + retained Google seat upgraded to Antigravity (`agy`)

Pre-dogfooding hardening across four surfaces, plus live verification of Google's
replacement CLI:

- **Gemini JSON advisor thinking cap + schema** (`src/providers/google.ts`) — advisor
  calls (`options.json === true`) now pass `responseJsonSchema: ADVISOR_JSON_SCHEMA`
  alongside `thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }`, resolving the P4
  gate truncation where unconstrained reasoning exhausted `maxOutputTokens` mid-JSON;
  synthesis calls keep unconstrained markdown reasoning.
- **SHA-256 ledger hash chain** (`src/ledger.ts`) — `renderLedger` and `writeLedger`
  embed `prev_sha256` (genesis `0{64}`) and `content_sha256` in `symposium-ledger/v3`
  frontmatter, committing to all frontmatter fields and body sections; `verifyLedger()`
  validates chronological chains while tolerating pre-v0.9 legacy files ahead of the
  first chained record.
- **Expanded secret redaction** (`src/council.ts`) — `redactSecrets()` now scrubs
  `ghp_*`, `github_pat_*`, `AKIA*`, `sk_*`, and `Bearer` tokens while preserving
  prose such as `"risk-tolerant"` and `"bearer instrument"`.
- **Retained seat upgraded from `gemini` to `agy`** (`src/router.ts`,
  `src/providers/retained.ts`, `src/theme.ts`) — verified live against `agy 1.5.9` on
  macOS: piped `stdin` triggers non-interactive print mode automatically (`-p` in
  `agy 1.5.9` requires an inline prompt string and must not be passed bare),
  `--mode plan --sandbox --output-format text --effort low` enforces sandboxed
  read-only planning (`--disable-slash-commands` is omitted because it disables
  `--mode plan`), and `agyCliAdapter` executes inside an ephemeral `mkdtempSync`
  directory so host workspaces stay isolated while user-level `~/.gemini/GEMINI.md`
  context still loads. Legacy `gemini` token in `SYMPOSIUM_RETAINED_SEATS` aliases
  cleanly to `agy` (`Antigravity`).
- **Dogfood hygiene** — removed premature `docs/announce-kit.md` and ignored
  `repomix-output.*` in `.gitignore`.

## 2026-11-16 — v0.9.1: the npm name is someone else's; retained seats were billing the API key; catalog refresh

A pre-use audit before the tool goes into daily service on a new project. Tests were
green throughout; every item below was found by checking the live world, not the suite.

- **`symposium-mcp` on npm is not ours.** An unrelated publisher claimed the name on
  2026-11-13 (a meeting-space MCP server, four releases by the 16th). This repo never
  published, but the public README told readers to run `npx -y symposium-mcp` with
  `OPENROUTER_API_KEY` in the environment — i.e. to execute a stranger's package holding
  their key. The one-liner is withdrawn and replaced with a warning; install is
  clone-only until a name the project controls is published. The MCP server name
  (`symposium`) and the tool (`convene_council`) are unchanged. Lesson recorded: an
  install command for an unclaimed registry name is a standing invitation — publish a
  placeholder or do not print the command.
- **Retained seats inherited the metered keys** (`src/providers/retained.ts`). The
  server's environment carries `ANTHROPIC_API_KEY` for the neutral Claude seat, and
  `claude -p` prefers that key over the subscription login (verified live on claude
  2.1.325: a bogus key in the environment produces `Invalid API key`, and the CLI warns
  that the key "takes precedence over your claude.ai login"). So wherever both were
  configured, the "retained — no API metering" Claude Code seat was billing the Console
  key per token and the ledger recorded $0. `runCli` now spawns with `retainedEnv()`:
  the server's environment minus every advisor key plus `ANTHROPIC_AUTH_TOKEN`,
  `CODEX_API_KEY`, `GOOGLE_API_KEY`. Earlier ledgers that seat Claude Code alongside
  a natively-keyed Claude under-report cost by that seat's tokens; they are not amended
  (write-once), this entry is the correction.
- **Claude answer-only mode is now an empty allowlist.** `--tools ""` replaces
  `--disallowedTools <thirteen names>`. The denylist was verified against 2.1.223 and
  the CLI has grown tools since; with a user-level `auto` permission mode the unlisted
  ones would have run unprompted. Verified on 2.1.325: the seat reports no callable
  tools. Codex flags re-checked against codex-cli 0.166.0, agy against 1.5.9 — unchanged.
- **Timeouts abort** (`src/council.ts`, every adapter). `withTimeout` used to reject and
  walk away; the provider call ran to completion and billed with no record, and a
  shortened `advisorMs` left a CLI child alive. An `AbortSignal` now reaches each SDK
  call and `runCli`.
- **The hash chain is ordered by its links, not by filename** (`src/ledger.ts`).
  Filenames carry the local minute a convening *started*. Three cases wrote a valid
  chain that `verifyLedger()` then rejected: two questions in the same minute written
  out of alphabetical order (this repo's own ledger has three convenings at
  `2026-08-10-1343`), the `-2` collision suffix (which sorts *before* the unsuffixed
  file), and a slow convening finishing after a later-started fast one. The head is now
  the entry no other entry names as predecessor, and verification walks from genesis;
  a fork (two writers racing on one directory) is reported as a fork. No chained ledger
  had been written before this fix, so nothing on disk needs repair.
- **Catalog refresh, verified 2026-11-16.** Ids against each provider's model-list
  endpoint; prices against Anthropic's and xAI's own listings, the OpenAI, Google and
  DeepSeek pricing pages, and `openrouter.ai/api/v1/models` for every OpenRouter row.
  - `claude-sonnet-5` $3/$15 → **$2/$10** (the native row was simply wrong; the
    OpenRouter row already said $2/$10).
  - DeepSeek: `deepseek-v4-flash` is a retired legacy alias, now served and billed as
    DeepSeek-V4.1-Flash — id → **`deepseek-flash`**. DeepSeek has introduced peak /
    off-peak pricing (peak is double); the catalog holds one price per row, so it
    records **peak**: flash $0.30/$1.20, `deepseek-v4-pro` $1.32/$3.96 (was $0.435/$0.87
    — up to 4.5× under on output). Off-peak convenings over-record by half.
  - OpenRouter fallbacks: `openai/gpt-5.6-luna` and `-terra` had been entered at half
    price (the batch column) → $0.20/$1.20 and $2/$12. `deepseek/deepseek-v4-flash-0731`
    → $0.06/$0.18; `deepseek/deepseek-v4-pro-0813` → $0.111/$4.44 (output had been 5×
    under).
  - **Deliberately left high:** `gpt-5.6-sol` is promotionally $4/$20 until 2026-11-30
    and `gemini-3.6-flash` $0.75/$3.75 until 2026-12-31; both native rows keep the
    post-promotion price ($5/$30, $1.50/$7.50), because an estimate that is too low is
    the unsafe direction for a budget cap. The OpenRouter `gpt-5.6-sol` row keeps $5/$30
    for the same reason; the OpenRouter `gemini-3.6-flash` row matches its billing
    source today and will need raising on 2027-01-01.
  - **Not changed — the operator's call:** every provider has shipped a newer
    generation (Claude 5.5, GPT-6, Gemini 4, Grok 4.7, DeepSeek V4.1, Qwen 3.8). Who
    sits on the council has always been decided by the operator or the council itself,
    so the roster stands; only ids and prices that were wrong were touched.
- **Packaging.** `package.json` is renamed from `symposium-mcp` to `@ai-et-al/symposium`
  (`publishConfig.access: "public"`, matching the GitHub org; unpublished until the
  operator claims the npm scope and signs off). `npm run build` now clears `dist/` first —
  a stale `dist/src/` tree from an old `rootDir` was riding every tarball (51 files → 39).
  The server reads its version from `package.json` instead of a second hard-coded string,
  and `package-lock.json` (still stamped 0.8.0) agrees again. `.claude/` and `.codex/` are
  gitignored: the project-level Codex config holds API keys in plaintext and sat
  untracked, one `git add -A` from a public repository.
- **Live verification.** One low-stakes convening on the working tree: nine seats
  planned, eight spoke (all three retained seats included), Qwen adjudicated, $0.0067
  against a $0.0261 estimate. The ninth, DeepSeek, returned `402 Insufficient Balance`
  — the account balance is $0.00, as it was in August. Not a code fault: fund it, or
  remove `DEEPSEEK_API_KEY` so the voice sits via OpenRouter.

## 2026-11-16 — v0.9.2: published to npm as `@ai-et-al/symposium`

The operator claimed the `@ai-et-al` scope the same afternoon (free npm organization
`ai-et-al`, owner `dmcs414`) and gave the word to publish. This is the first release on
the registry; the publish gate that had stood since the 2026-08-10 npm convening is
closed by the operator's own act. The announce gate is untouched — no launch kit, no
post.

- **Ledger default for an installed package** (`src/ledger.ts`). The default was
  `<package root>/ledger`, which for `npx` is a directory inside npm's cache — a place
  npm is free to clear. A record the operator owns cannot live there. When the package
  root sits under `node_modules` and `SYMPOSIUM_LEDGER_DIR` is unset, records now go to
  `~/symposium-ledger/`; a clone still writes `<repo>/ledger`. The server names the
  directory on startup.
- **Install path restored, under the scope.** The README offers
  `npx -y @ai-et-al/symposium` again and keeps the warning that unscoped
  `symposium-mcp` is someone else's. A scope can only be published to by its members,
  which is the property the unscoped name never had.
- **Order of operations:** publish first, push second, so the public README never
  again names a package that does not exist.
