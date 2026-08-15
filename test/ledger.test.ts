import { describe, expect, it } from "vitest";
import { renderLedger, type LedgerEntry } from "../src/ledger.js";

const ENTRY: LedgerEntry = {
  date: new Date("2026-08-15T12:00:00.000Z"),
  question: "Q?",
  stakes: "medium",
  advisorModelIds: ["anthro-med", "retained: claude-code"],
  synthModelId: "anthro-high",
  costUsd: 0.0105,
  latencyMs: 1234,
  positions: [
    {
      advisor: "Claude",
      modelId: "anthro-med",
      provenance: "neutral",
      confidence: 0.7,
      position: "P",
      uncertainties: [],
      selfObjection: "s",
      costUsd: 0.0105,
    },
    {
      advisor: "Claude Code",
      modelId: "claude-code",
      provenance: "retained",
      confidence: 0.8,
      position: "R",
      uncertainties: ["u"],
      selfObjection: "o",
      // no costUsd: retained seats are unmetered
    },
  ],
  dissent: "- d",
  verdicts: [{ advisor: "Claude", verdict: "adopt" }],
  synthesis: "S",
  relations: [],
};

describe("renderLedger (schema v3)", () => {
  const md = renderLedger(ENTRY);

  it("declares schema v3", () => {
    expect(md).toContain("schema: symposium-ledger/v3");
  });

  it("declares provenance on every position heading", () => {
    expect(md).toContain("### Claude (anthro-med) — neutral — confidence 0.70 — cost $0.0105");
    expect(md).toContain("### Claude Code (claude-code) — retained — confidence 0.80");
  });

  it("omits cost for unmetered retained seats", () => {
    expect(md).not.toMatch(/retained — confidence 0\.80 — cost/);
  });

  it("carries the retained: prefix through the frontmatter models list", () => {
    expect(md).toContain("models: [anthro-med, retained: claude-code, synth: anthro-high]");
  });
});
