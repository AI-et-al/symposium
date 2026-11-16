import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GENESIS_SHA256,
  renderLedger,
  verifyLedger,
  writeLedger,
  type LedgerEntry,
  defaultLedgerDir,
} from "../src/ledger.js";

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

describe("renderLedger (schema v3 + hash chain)", () => {
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

  it("embeds prev_sha256 and content_sha256 in frontmatter", () => {
    expect(md).toContain(`prev_sha256: ${GENESIS_SHA256}`);
    expect(md).toMatch(/^content_sha256: [0-9a-f]{64}$/m);
  });
});

describe("writeLedger + verifyLedger hash chain", () => {
  it("chains consecutive entries and verifies cleanly", () => {
    const dir = mkdtempSync(join(tmpdir(), "symposium-ledger-chain-"));
    try {
      const p1 = writeLedger({ ...ENTRY, date: new Date("2026-11-15T10:00:00.000Z"), question: "First?" }, dir);
      const p2 = writeLedger({ ...ENTRY, date: new Date("2026-11-15T10:05:00.000Z"), question: "Second?" }, dir);
      const p3 = writeLedger({ ...ENTRY, date: new Date("2026-11-15T10:10:00.000Z"), question: "Third?" }, dir);

      const h1 = /^content_sha256: ([0-9a-f]{64})$/m.exec(readFileSync(p1, "utf8"))![1];
      const h2Prev = /^prev_sha256: ([0-9a-f]{64})$/m.exec(readFileSync(p2, "utf8"))![1];
      const h3 = /^content_sha256: ([0-9a-f]{64})$/m.exec(readFileSync(p3, "utf8"))![1];
      expect(h2Prev).toBe(h1);

      const check = verifyLedger(dir);
      expect(check).toEqual({
        valid: true,
        checked: 3,
        legacySkipped: 0,
        headSha256: h3,
        errors: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects body/frontmatter tampering and deleted middle entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "symposium-ledger-tamper-"));
    try {
      writeLedger({ ...ENTRY, date: new Date("2026-11-15T11:00:00.000Z"), question: "One" }, dir);
      const p2 = writeLedger({ ...ENTRY, date: new Date("2026-11-15T11:05:00.000Z"), question: "Two" }, dir);
      const p3 = writeLedger({ ...ENTRY, date: new Date("2026-11-15T11:10:00.000Z"), question: "Three" }, dir);

      const originalP2 = readFileSync(p2, "utf8");
      writeFileSync(p2, originalP2.replace("Synthesis\nS", "Synthesis\nTampered!"), "utf8");
      const tampered = verifyLedger(dir);
      expect(tampered.valid).toBe(false);
      expect(tampered.errors[0]).toContain("tampered content");

      // Restore p2, then delete p2 so p3's prev_sha256 dangles.
      writeFileSync(p2, originalP2, "utf8");
      expect(verifyLedger(dir).valid).toBe(true);
      unlinkSync(p2);
      const broken = verifyLedger(dir);
      expect(broken.valid).toBe(false);
      expect(broken.errors[0]).toContain("broken chain");
      expect(p3).toBeTruthy();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("follows links, not filenames: same-minute, collision-suffixed, and overlapping convenings verify", () => {
    const dir = mkdtempSync(join(tmpdir(), "symposium-ledger-order-"));
    try {
      const minute = new Date("2026-11-16T15:30:00.000Z");
      // Same minute, written in the opposite of filename order.
      writeLedger({ ...ENTRY, date: minute, question: "Zebra?" }, dir);
      writeLedger({ ...ENTRY, date: minute, question: "Apple?" }, dir);
      // Same minute and same question: `-2` sorts BEFORE the unsuffixed file.
      writeLedger({ ...ENTRY, date: minute, question: "Apple?" }, dir);
      // A long convening that started earlier but was written last.
      const last = writeLedger(
        { ...ENTRY, date: new Date("2026-11-16T15:10:00.000Z"), question: "Slow?" },
        dir,
      );

      const check = verifyLedger(dir);
      expect(check.errors).toEqual([]);
      expect(check.checked).toBe(4);
      expect(check.headSha256).toBe(
        /^content_sha256: ([0-9a-f]{64})$/m.exec(readFileSync(last, "utf8"))![1],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a fork when two entries name the same predecessor", () => {
    const dir = mkdtempSync(join(tmpdir(), "symposium-ledger-fork-"));
    try {
      const p1 = writeLedger({ ...ENTRY, date: new Date("2026-11-15T13:00:00.000Z"), question: "Root" }, dir);
      const h1 = /^content_sha256: ([0-9a-f]{64})$/m.exec(readFileSync(p1, "utf8"))![1];
      writeLedger({ ...ENTRY, date: new Date("2026-11-15T13:05:00.000Z"), question: "Left" }, dir);
      // A second writer that read the head before "Left" landed.
      writeFileSync(
        join(dir, "2026-11-15-2300-right.md"),
        renderLedger({ ...ENTRY, date: new Date("2026-11-15T13:06:00.000Z"), question: "Right" }, h1),
        "utf8",
      );
      const forked = verifyLedger(dir);
      expect(forked.valid).toBe(false);
      expect(forked.errors.join("\n")).toContain("forked chain");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips pre-v0.9 unhashed files before the chain, but rejects unhashed files after", () => {
    const dir = mkdtempSync(join(tmpdir(), "symposium-ledger-legacy-"));
    try {
      writeFileSync(
        join(dir, "2026-08-10-1200-legacy.md"),
        "---\nschema: symposium-ledger/v3\n---\n# Legacy\n",
        "utf8",
      );
      writeLedger({ ...ENTRY, date: new Date("2026-11-15T12:00:00.000Z"), question: "Chained" }, dir);
      const ok = verifyLedger(dir);
      expect(ok.valid).toBe(true);
      expect(ok.legacySkipped).toBe(1);
      expect(ok.checked).toBe(1);

      writeFileSync(
        join(dir, "2026-11-15-2359-stripped.md"),
        "---\nschema: symposium-ledger/v3\n---\n# Stripped\n",
        "utf8",
      );
      const bad = verifyLedger(dir);
      expect(bad.valid).toBe(false);
      expect(bad.errors[0]).toContain("missing prev_sha256/content_sha256 after hash chain started");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("defaultLedgerDir", () => {
  it("keeps a clone's records in <repo>/ledger", () => {
    expect(defaultLedgerDir(join("/work", "symposium"), "/home/op")).toBe(
      join("/work", "symposium", "ledger"),
    );
  });

  it("sends an installed package's records to ~/symposium-ledger, never npm's cache", () => {
    const npx = join("/home/op", ".npm", "_npx", "ab12", "node_modules", "@ai-et-al", "symposium");
    expect(defaultLedgerDir(npx, "/home/op")).toBe(join("/home/op", "symposium-ledger"));
  });
});
