import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Stakes = "low" | "medium" | "high" | "audited";

export interface AdvisorPosition {
  advisor: string;
  modelId: string;
  /** Seat provenance (schema v3): retained | neutral. Omitted only for pre-v3 callers. */
  provenance?: "neutral" | "retained";
  confidence: number;
  position: string;
  uncertainties: string[];
  selfObjection: string;
  /** Actual per-seat spend; omit for unmetered (retained) seats per the spec. */
  costUsd?: number;
}

export interface LedgerVerdict {
  advisor: string;
  verdict: string;
  note?: string;
}

export interface LedgerEntry {
  date: Date;
  question: string;
  context?: string;
  stakes: Stakes;
  advisorModelIds: string[];
  synthModelId: string;
  costUsd: number;
  latencyMs: number;
  positions: AdvisorPosition[];
  /** Markdown list body for the DISSENT section. */
  dissent: string;
  /** Machine-readable per-advisor verdicts (schema v2); may be empty when synthesis never ran. */
  verdicts: LedgerVerdict[];
  /** Synthesis text, or open questions for the human when stakes are high/audited. */
  synthesis: string;
  /** Wikilink targets for the Relations section. */
  relations: string[];
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** SYMPOSIUM_LEDGER_DIR wins; default is <repo>/ledger regardless of cwd. */
export function ledgerDir(): string {
  const fromEnv = process.env.SYMPOSIUM_LEDGER_DIR;
  return fromEnv ? resolve(fromEnv) : join(packageRoot, "ledger");
}

export function slugify(question: string): string {
  const slug = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "convening";
}

function filenameTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function renderPositions(positions: AdvisorPosition[]): string {
  return positions
    .map(
      (p) =>
        `### ${p.advisor} (${p.modelId})` +
        (p.provenance ? ` — ${p.provenance}` : "") +
        ` — confidence ${p.confidence.toFixed(2)}` +
        (p.costUsd !== undefined ? ` — cost $${p.costUsd.toFixed(4)}` : "") +
        `\n${p.position}\n` +
        `- Uncertainties: ${p.uncertainties.join("; ") || "none stated"}\n` +
        `- Self-objection: ${p.selfObjection}`,
    )
    .join("\n\n");
}

function renderVerdicts(verdicts: LedgerVerdict[]): string {
  if (verdicts.length === 0) return "*None — synthesis did not run.*";
  return verdicts
    .map((v) => `- ${v.advisor}: ${v.verdict}${v.note ? ` — ${v.note}` : ""}`)
    .join("\n");
}

export function renderLedger(entry: LedgerEntry): string {
  const mode = entry.stakes === "audited" ? "audited" : "standard";
  const models = [...entry.advisorModelIds, `synth: ${entry.synthModelId}`].join(", ");
  const title = entry.question.slice(0, 80);
  const relations =
    entry.relations.map((r) => `- relates_to [[${r}]]`).join("\n") ||
    `- relates_to [[${slugify(entry.question)}]]`;

  return `---
schema: symposium-ledger/v3
date: ${entry.date.toISOString()}
stakes: ${entry.stakes}
mode: ${mode}
models: [${models}]
cost_usd: ${entry.costUsd.toFixed(4)}
latency_ms: ${Math.round(entry.latencyMs)}
---
# ${title}

## Question
${entry.question}${entry.context ? `\n\n${entry.context}` : ""}

## Positions
${renderPositions(entry.positions)}

## DISSENT
${entry.dissent}

## Verdicts
${renderVerdicts(entry.verdicts)}

## Synthesis
${entry.synthesis}

## Relations
${relations}
`;
}

/** Writes one convening to the ledger; returns the absolute path written. */
export function writeLedger(entry: LedgerEntry): string {
  const dir = ledgerDir();
  mkdirSync(dir, { recursive: true });

  const base = `${filenameTimestamp(entry.date)}-${slugify(entry.question)}`;
  let path = join(dir, `${base}.md`);
  for (let n = 2; existsSync(path); n++) {
    path = join(dir, `${base}-${n}.md`);
  }

  writeFileSync(path, renderLedger(entry), { encoding: "utf8", flag: "wx" });
  return path;
}
