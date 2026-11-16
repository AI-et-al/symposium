import { describe, expect, it } from "vitest";
import { chipAttributions, SEAT } from "../src/theme.js";

describe("chipAttributions", () => {
  it("chips attribution lines with each seat's own chip", () => {
    const body = ['> **Claude —** "the record does the work"'].join("\n");
    expect(chipAttributions(body)).toBe('> **🟠 Claude —** "the record does the work"');
  });

  it("gives Claude Code its own chip, never Claude's (longest name wins)", () => {
    const body = [
      '> **Claude Code —** "my operator prefers exact pins"',
      ">",
      '> **Claude —** "no such context available to me"',
    ].join("\n");
    const out = chipAttributions(body);
    expect(out).toContain('> **🧡 Claude Code —**');
    expect(out).toContain('> **🟠 Claude —**');
    expect(out).not.toContain("🟠 Claude Code");
  });

  it("never chips a seat name inside a quoted body", () => {
    const body = '> **GPT —** "Claude Code and Antigravity both overstate their context"';
    expect(chipAttributions(body)).toBe(
      '> **🟢 GPT —** "Claude Code and Antigravity both overstate their context"',
    );
  });

  it("has a chip and fill for every seat, retained seats sharing the provider hue", () => {
    expect(SEAT["Claude Code"].fill).toBe(SEAT.Claude.fill);
    expect(SEAT.Codex.fill).toBe(SEAT.GPT.fill);
    expect(SEAT.Antigravity.fill).toBe(SEAT.Gemini.fill);
    expect(SEAT["Claude Code"].chip).not.toBe(SEAT.Claude.chip);
  });
});
