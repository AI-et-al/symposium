import type { AdvisorOutcome, AdvisorVerdict } from "./council.js";
import type { AdvisorName } from "./router.js";

// ── The chamber theme (docs/council-theme.md) ────────────────────────────────
// Color carriers that survive MCP tool-result rendering: emoji chips + diff fences.
// SYMPOSIUM_MONOCHROME=1 degrades to the glyph ladder with no loss of meaning.
// Retained seats wear hearts (a seat that carries its human), neutral seats circles;
// both share the provider's hue, because identity and provenance are separate axes.

export const MONO = process.env.SYMPOSIUM_MONOCHROME === "1";

export const SEAT: Record<AdvisorName, { chip: string; fill: string }> = {
  Claude: { chip: "🟠", fill: "🟧" },
  GPT: { chip: "🟢", fill: "🟩" },
  Gemini: { chip: "🔵", fill: "🟦" },
  Grok: { chip: "⚫", fill: "⬛" },
  DeepSeek: { chip: "🟣", fill: "🟪" },
  "Claude Code": { chip: "🧡", fill: "🟧" },
  Codex: { chip: "💚", fill: "🟩" },
  "Gemini CLI": { chip: "💙", fill: "🟦" },
};

export const chip = (name: AdvisorName) => (MONO ? "●" : SEAT[name].chip);

export function bar(name: AdvisorName, confidence: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(confidence * 10)));
  return MONO
    ? "▓".repeat(filled) + "░".repeat(10 - filled)
    : SEAT[name].fill.repeat(filled) + "⬜".repeat(10 - filled);
}

export const EMPTY_BAR = (MONO ? "░".repeat(10) : "⬜".repeat(10)) + " ✗";
export const BAND = "▓".repeat(48);
export const DEGRADED_BAND = "▒".repeat(48);
export const BROKEN_BAND = "█".repeat(48);

export function budgetMeter(spentUsd: number, capUsd: number, breached: boolean): string {
  if (breached) return (MONO ? "█".repeat(10) : "🟥".repeat(10)) + ` ${Math.round((spentUsd / capUsd) * 100)}% of $${capUsd.toFixed(4)} cap — breached ✗`;
  const filled = Math.max(0, Math.min(10, Math.round((spentUsd / capUsd) * 10)));
  const fill = MONO ? "▓" : "🟩";
  const empty = MONO ? "░" : "⬜";
  return fill.repeat(filled) + empty.repeat(10 - filled) + ` ${Math.round((spentUsd / capUsd) * 100)}% of $${capUsd.toFixed(4)} cap`;
}

// Longest name first so "Claude Code" never half-matches as "Claude" (same for
// "Gemini CLI"/"Gemini") — one seat's chip must never land on another seat's line.
const NAME_ALTERNATION = (Object.keys(SEAT) as AdvisorName[])
  .sort((a, b) => b.length - a.length)
  .join("|");
const ATTRIBUTION_RE = new RegExp(`^(>\\s*\\*\\*)(${NAME_ALTERNATION})(\\s*—)`, "gm");

/** Chip only attribution lines (`> **Name —**`) — never names inside quoted bodies. */
export function chipAttributions(dissentBody: string): string {
  if (MONO) return dissentBody;
  return dissentBody.replace(
    ATTRIBUTION_RE,
    (_m, pre: string, name: string, post: string) =>
      `${pre}${SEAT[name as AdvisorName].chip} ${name}${post}`,
  );
}

export function firstSentence(text: string, max = 64): string {
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return sentence.length <= max ? sentence : sentence.slice(0, max - 1).trimEnd() + "…";
}

export const STATUS_MARK: Record<AdvisorOutcome["status"], string> = {
  ok: "",
  malformed: "◐ ",
  error: "✗ ",
};

export function verdictDiff(verdicts: AdvisorVerdict[]): string[] {
  if (verdicts.length === 0 || verdicts.every((v) => v.verdict === "unspecified")) return [];
  const lines = verdicts.map((v) => {
    const prefix = v.verdict === "adopt" ? "+" : v.verdict === "reject" ? "-" : " ";
    const word = { adopt: "adopts", reject: "rejects", partial: "partial", abstain: "abstain", open: "open", unspecified: "—" }[v.verdict];
    return `${prefix} ${word.padEnd(8)} ${chip(v.advisor)} ${v.advisor.padEnd(11)}${v.note ? ` ${v.note}` : ""}`;
  });
  return ["## VERDICTS", "", "```diff", ...lines, "```", ""];
}
