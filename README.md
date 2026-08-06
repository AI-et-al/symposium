# Symposium

![Symposium — Feuerbach's Plato's Symposium, rendered in ASCII](assets/AI-et-al_Symposium.gif)

**Multi-model deliberation as an MCP server.** Convene Claude, GPT, and Gemini
on one question. Surface their disagreement verbatim. Keep the record in plain
Markdown you own.

> ⚠️ **Status: pre-alpha — spec stage.** The design is committed
> ([SYMPOSIUM_SPEC.md](SYMPOSIUM_SPEC.md)); the code is not written yet.
> Nothing here runs. Star/watch if the idea interests you.

## The idea

Every AI harness gives you one model's answer. For decisions that matter, one
confident answer is exactly the wrong shape — what you want is the structure of
the disagreement: where independent frontier models diverge, how confident each
is, and what each thinks is wrong with its own position.

Symposium is a single MCP tool, `convene_council`, that any MCP-capable harness
(Claude Code, Claude Desktop, Letta Code, Cursor, ...) can call:

1. **Fan out** the question to advisors from three providers, tiered by stakes
   and constrained by a hard budget shown *before* any call is made.
2. **Collect** structured positions: answer, confidence, key uncertainties, and
   each advisor's strongest objection to its own position.
3. **Synthesize** under one non-negotiable rule: material disagreement is
   reproduced verbatim and attributed — never averaged, softened, or omitted.
   High-stakes convenings don't conclude at all; they end with the questions a
   human must answer.
4. **Record** every deliberation as one Markdown file — question, positions,
   dissent, synthesis, cost — in a ledger directory you control. The format is
   knowledge-graph-friendly (frontmatter + wikilinks), so tools like Basic
   Memory can index your deliberation history automatically.

The mechanism is simple on purpose. The product is the **ledger**: an
accumulating, inspectable, portable record of what was asked, who dissented,
and what was decided.

## Principles

- **Disagreement is the signal.** Consensus that hides conflict is a bug.
- **Bounded and observable.** Small steps, pre-flight cost estimates, hard caps
  enforced in code.
- **The human is primary.** High-stakes questions return dissent for human
  judgment, not auto-conclusions.
- **Thin and portable.** Standard provider APIs, plain files, no database, no
  lock-in. Lose a provider, lose one voice — the council continues.

## Non-goals (v1)

No streaming. No web UI. No hosted mode. No memory of prior convenings — the
ledger *is* the memory. No more than one tool. No agent loops: Symposium is
called *by* agents and harnesses; it never becomes one.

## Lineage

Extracted from [Janus](https://github.com/AI-et-al/Janus), a multi-model
orchestration platform whose platform ambitions were retired in favor of this
one component (see [DECISIONS.md](DECISIONS.md)). Intellectual debts:
Karpathy's [llm-council](https://github.com/karpathy/llm-council) for the
demo-scale proof of the pattern, and the constraint that every step be small,
bounded, and observable.

## Roadmap

Build phases, gates, tool schema, ledger format, and router design are all in
[SYMPOSIUM_SPEC.md](SYMPOSIUM_SPEC.md). This README will be rewritten at Phase
5 with install instructions and a real example ledger file — not before,
because install instructions for unbuilt software are fiction.

## License

AGPL-3.0 (server). The ledger format specification is CC0 — the format should
spread even where the server doesn't.
