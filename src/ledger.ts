import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Stakes = "low" | "medium" | "high" | "audited";

/** Sentinel `prev_sha256` for the first hash-chained entry in a ledger directory. */
export const GENESIS_SHA256 = "0".repeat(64);

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

export interface LedgerVerification {
  valid: boolean;
  checked: number;
  legacySkipped: number;
  headSha256: string;
  errors: string[];
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** SYMPOSIUM_LEDGER_DIR wins; default is <repo>/ledger regardless of cwd. */
export function ledgerDir(): string {
  const fromEnv = process.env.SYMPOSIUM_LEDGER_DIR;
  return fromEnv ? resolve(fromEnv) : join(packageRoot, "ledger");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Canonical payload hashed by `content_sha256`: the full ledger file with only its own
 * `content_sha256:` line removed, so the digest commits to frontmatter (including
 * `prev_sha256`) and every Markdown body section simultaneously.
 */
function canonicalizeForHash(markdown: string): string {
  return markdown.replace(/^content_sha256: [0-9a-f]{64}\r?\n/m, "");
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

export function renderLedger(entry: LedgerEntry, prevSha256: string = GENESIS_SHA256): string {
  const mode = entry.stakes === "audited" ? "audited" : "standard";
  const models = [...entry.advisorModelIds, `synth: ${entry.synthModelId}`].join(", ");
  const title = entry.question.slice(0, 80);
  const relations =
    entry.relations.map((r) => `- relates_to [[${r}]]`).join("\n") ||
    `- relates_to [[${slugify(entry.question)}]]`;

  const body = `# ${title}

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

  const headerPrefix = `---
schema: symposium-ledger/v3
date: ${entry.date.toISOString()}
stakes: ${entry.stakes}
mode: ${mode}
models: [${models}]
cost_usd: ${entry.costUsd.toFixed(4)}
latency_ms: ${Math.round(entry.latencyMs)}
prev_sha256: ${prevSha256}
`;
  const headerSuffix = `---\n`;

  const contentSha256 = sha256Hex(`${headerPrefix}${headerSuffix}${body}`);
  return `${headerPrefix}content_sha256: ${contentSha256}\n${headerSuffix}${body}`;
}

function latestLedgerHash(dir: string): string {
  if (!existsSync(dir)) return GENESIS_SHA256;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const raw = readFileSync(join(dir, files[i]), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1];
    if (!fm) continue;
    const match = /^content_sha256:\s*([0-9a-f]{64})\s*$/m.exec(fm);
    if (match) return match[1];
  }
  return GENESIS_SHA256;
}

/** Writes one hash-chained convening to the ledger; returns the absolute path written. */
export function writeLedger(entry: LedgerEntry, dir: string = ledgerDir()): string {
  mkdirSync(dir, { recursive: true });
  const prevSha256 = latestLedgerHash(dir);

  const base = `${filenameTimestamp(entry.date)}-${slugify(entry.question)}`;
  let path = join(dir, `${base}.md`);
  for (let n = 2; existsSync(path); n++) {
    path = join(dir, `${base}-${n}.md`);
  }

  writeFileSync(path, renderLedger(entry, prevSha256), { encoding: "utf8", flag: "wx" });
  return path;
}

/**
 * Verifies the SHA-256 hash chain (`prev_sha256` -> `content_sha256`) across all
 * `.md` ledger files in `dir` in chronological filename order. Pre-v0.9 entries
 * predating the first chained record are skipped cleanly; missing or altered hashes
 * once chaining begins are reported as errors.
 */
export function verifyLedger(dir: string = ledgerDir()): LedgerVerification {
  if (!existsSync(dir)) {
    return { valid: true, checked: 0, legacySkipped: 0, headSha256: GENESIS_SHA256, errors: [] };
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  let expectedPrev = GENESIS_SHA256;
  let chainStarted = false;
  let checked = 0;
  let legacySkipped = 0;
  const errors: string[] = [];

  for (const file of files) {
    const raw = readFileSync(join(dir, file), "utf8");
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
    const prevMatch = /^prev_sha256:\s*(\S+)\s*$/m.exec(fm);
    const contentMatch = /^content_sha256:\s*(\S+)\s*$/m.exec(fm);

    if (!prevMatch && !contentMatch) {
      if (!chainStarted) {
        legacySkipped++;
        continue;
      }
      errors.push(`${file}: missing prev_sha256/content_sha256 after hash chain started`);
      continue;
    }

    chainStarted = true;
    checked++;

    if (!prevMatch || !contentMatch) {
      errors.push(`${file}: incomplete hash-chain frontmatter`);
      continue;
    }

    const prevSha = prevMatch[1];
    const contentSha = contentMatch[1];

    if (prevSha !== expectedPrev) {
      errors.push(`${file}: broken chain — prev_sha256 is ${prevSha}, expected ${expectedPrev}`);
    }

    const recomputed = sha256Hex(canonicalizeForHash(raw));
    if (contentSha !== recomputed) {
      errors.push(
        `${file}: tampered content — content_sha256 is ${contentSha}, recomputed ${recomputed}`,
      );
    }

    expectedPrev = contentSha;
  }

  return {
    valid: errors.length === 0,
    checked,
    legacySkipped,
    headSha256: expectedPrev,
    errors,
  };
}
