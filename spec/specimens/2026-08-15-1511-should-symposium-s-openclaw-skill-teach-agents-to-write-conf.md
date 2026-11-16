---
schema: symposium-ledger/v3
date: 2026-08-15T20:11:17.978Z
stakes: medium
mode: standard
models: [retained: claude-code, retained: codex, synth: none]
cost_usd: 0.0000
latency_ms: 32731
---
# Should Symposium's OpenClaw skill teach agents to write conformant deliberation 

## Question
Should Symposium's OpenClaw skill teach agents to write conformant deliberation records natively (format-first), or teach them to call the convene_council MCP tool (tool-first)?

Motion 3 of an adopted three-motion plan: ship an OpenClaw skill last, 'only carrying a citable norm and a hardened secrets story' into a skill marketplace with a documented trust crisis (341 malicious skills, 7.1% mishandling secrets). The ledger format spec is CC0 and standalone; the server is AGPL. A format-first skill teaches any agent to produce symposium-ledger/v3 records with no dependency on this server; a tool-first skill drives installs but requires API keys configured in the agent's environment. The council's own prior ruling: norm success outranks project survival.

## Positions
### Claude Code (claude-code) — retained — confidence 0.86
Format-first, and the motion's own text nearly decides it. The skill was chartered to carry 'only a citable norm and a hardened secrets story' into a marketplace whose documented failure mode is skills mishandling secrets. A tool-first skill that requires API keys in the agent's environment is structurally the thing the marketplace is currently punishing — it makes Symposium's skill one more credential-demanding installable in a 7.1%-mishandling ecosystem, and it makes the secrets story a liability to manage rather than a differentiator to cite. A format-first skill has no secrets at all: the hardest possible hardening. Second, the licensing already encodes the answer: the spec is CC0 precisely so the norm can outlive and outgrow the AGPL server. A skill teaching native symposium-ledger/v3 production makes every agent a conformance point and every marketplace install a norm-transmission event, with zero dependency on the project's continued existence. Tool-first inverts that — the norm's reach becomes bounded by server uptime, key provisioning, and install friction. The council's prior ruling (norm success outranks project survival) was made for exactly this trade: tool-first optimizes installs, format-first optimizes conformance. Ship format-first, but include a self-validation step in the skill (checklist or schema check against the CC0 spec) so native records don't drift, and mention the MCP tool as an optional backend for agents whose operators already run the server. My operator context includes adjacent council-governance work but nothing Symposium-specific that changes this; I answer on the merits plus the pattern that specs which survive independent implementation are the ones that become norms.

*Dissent from framing:* The binary is softer than posed: what defines the skill is what it requires, not what it mentions. A format-first skill can still document the MCP tool as an optional, clearly-labeled escalation path for server operators. The real decision is whether API keys are a prerequisite — and framing it as format-vs-tool obscures that the defensible middle (format-native, tool-optional) captures most of tool-first's upside at none of its secrets cost.
- Uncertainties: Whether LLM agents writing v3 records natively will actually conform without a machine validator in the loop — near-conformant drift could dilute the norm worse than low adoption would; Whether marketplace discovery favors tool-backed skills enough that a format-only skill goes unfound, making the norm-carrying skill inert in practice
- Self-objection: A norm nobody can verify is a style guide, not a standard. The convene_council tool is the only path that guarantees conformant records and gives the project telemetry on real usage; format-first may seed a thousand slightly-wrong ledgers that poison the citable corpus, and if the project dies from zero installs, the AGPL server that anchors reference behavior dies with it — 'norm over survival' assumes the norm can survive alone, which is unproven.

### Codex (codex) — retained — confidence 0.96
Format-first. The adopted priority—norm success over project survival—decides the issue. Teach agents to generate and validate standalone symposium-ledger/v3 records without installing the AGPL server or provisioning credentials. That maximizes portability, auditability, forkability, and survival of the deliberation norm beyond Symposium itself. It also matches Motion 3’s requirement for a hardened secrets story: the safest default is requiring no secret at all. The skill should cite the CC0 specification, include deterministic templates and validation checks, and clearly distinguish required fields from optional provenance. It may document convene_council as an optional execution path for users who want orchestration, but must not make the tool or an API key necessary for conformance. Tool-first would optimize distribution for the project rather than distribution of the norm, contradicting the council’s ruling and increasing exposure in a marketplace already demonstrating serious supply-chain and credential-handling failures.

*Dissent from framing:* The choice should govern the skill’s default contract, not exclude the other path: make conformance format-first and dependency-free, with convene_council presented as an optional hardened adapter.
- Uncertainties: Whether agents can reliably produce fully conformant v3 records without a reference validator or schema-backed generation; Whether marketplace discovery materially favors action-oriented tool skills over specification-oriented skills
- Self-objection: A tool-first skill could enforce conformance centrally, reduce malformed records, provide provenance and validation automatically, and create the adoption, telemetry, and maintenance incentives needed for the norm to become widely used rather than merely available.

## DISSENT
*No synthesizer was available — no neutral API seat holds a key; dissent not adjudicated.*

## Verdicts
*None — synthesis did not run.*

## Synthesis
No synthesis: the council convened without a neutral synthesizer (retained seats do not adjudicate dissent in v0.7). The positions above are preserved verbatim; the reader is the synthesizer.

## Relations
- relates_to [[should-symposium-s-openclaw-skill-teach-agents-to-write-conf]]
