# Janus, briefly

Symposium was extracted from [Janus](https://github.com/AI-et-al/Janus)
(AI-et-al/Janus, MIT, public), a research platform for coordinating multiple LLMs
and tool-using agents over long-horizon tasks. This note is the bridge between the
two repos: what Janus was, what survived into Symposium, and what was deliberately
left behind. A fuller chronicle may follow; this is the receipt, not the memoir.

## What Janus was

A layered orchestration platform: a **context bridge** (Git-backed persistent state
across sessions), a **model router** (cost-aware provider selection with budget
tracking), and a **swarm architecture** — scout (research with mandatory
verification), council (multiple advisor models deliberating), executor (bounded
code generation). The name is the two-faced god: remember backward, plan forward.

## What survived, with receipts

Each survival maps to a directive in the [Janus
MANIFESTO](https://github.com/AI-et-al/Janus/blob/main/MANIFESTO.md), which was
injected into every Janus context:

- **"Disagreement Is Signal"** — *"Your disagreement is the most valuable
  information in the system. Surface it."* → Symposium's first principle:
  disagreement surfaced, never averaged; the verbatim DISSENT section; a synthesis
  that papers over conflict is a bug of the highest severity.
- **"Show Your Work"** — confidence, uncertainties, assumptions, alternatives
  rejected → the advisor JSON contract, nearly field for field: `confidence`,
  `key_uncertainties`, `strongest_objection_to_own_position`,
  `dissent_from_framing`.
- **"Incremental Over Heroic," named the Karpathy Principle in Janus** → the spec's
  *Karpathy constraint*: every step small, bounded, observable; cost estimated and
  shown before fan-out; hard caps in code.
- **"Honor Constraints" / human control over plans, costs, decisions** → the human
  is primary: high-stakes convenings end with open questions, not conclusions.
- **The council swarm and the model router** are the two components extracted
  bodily — Janus's council already had advisors presenting proposals with
  confidence and uncertainties, disagreements surfaced, a synthesis step that
  could "highlight issues requiring human input."

## What was left behind, deliberately

- **The context bridge.** Symposium keeps no memory of prior convenings — the
  ledger plus the operator's own notes tool is the memory. Persistence became a
  *file the human owns* instead of a subsystem.
- **The scout and executor swarms, and the orchestrator.** Symposium is called
  *by* agents; it never becomes one. (The scout's "Draconian Scout Protocol" —
  verify or don't cite — survives as culture: see the model catalog's
  verified-against-live-docs rule.)
- **The platform ambition.** Janus coordinated long-horizon work end to end;
  Symposium does one thing: convene, preserve dissent, write the record.

The retirement decision is the first line of [`DECISIONS.md`](../DECISIONS.md):
platform retired, council + router extracted, thin-and-portable rationale.

## On llm-council

Andrej Karpathy's [llm-council](https://github.com/karpathy/llm-council) is kin
this lineage is gladly indebted to: several models on one question, anonymized
peer review, a Chairman compiling one final answer. We make no claims about
timelines and want none — the interesting relationship isn't chronological, it's
structural. llm-council optimizes for the answer; the Janus-to-Symposium line
optimizes for the record: dissent preserved rather than compiled away, a file the
human owns, refusal to conclude at high stakes. A tool that compiles the argument
away brilliantly is the clearest possible demonstration of why a tool that
preserves it should also exist. That demonstration is the debt.
