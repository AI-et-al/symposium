import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
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

/**
 * Where the ledger goes when SYMPOSIUM_LEDGER_DIR is unset. A clone keeps its records
 * in `<repo>/ledger`. An installed package (`npx`, `npm i -g`) lives under
 * `node_modules` — inside npm's cache for npx, which npm may clear — so its records go
 * to `~/symposium-ledger` instead: a ledger the operator owns cannot sit in a cache.
 */
export function defaultLedgerDir(root: string = packageRoot, home: string = homedir()): string {
  return root.split(sep).includes("node_modules")
    ? join(home, "symposium-ledger")
    : join(root, "ledger");
}

/** SYMPOSIUM_LEDGER_DIR wins; otherwise `defaultLedgerDir()`, regardless of cwd. */
export function ledgerDir(): string {
  const fromEnv = process.env.SYMPOSIUM_LEDGER_DIR;
  return fromEnv ? resolve(fromEnv) : defaultLedgerDir();
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

interface ChainRecord {
  file: string;
  raw: string;
  prev?: string;
  content?: string;
}

/** Reads the chain fields of every `.md` file in `dir`, in filename order. */
function readChainRecords(dir: string): ChainRecord[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), "utf8");
      const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw)?.[1] ?? "";
      const prev = /^prev_sha256:\s*(\S+)\s*$/m.exec(fm)?.[1];
      const content = /^content_sha256:\s*(\S+)\s*$/m.exec(fm)?.[1];
      return { file, raw, ...(prev ? { prev } : {}), ...(content ? { content } : {}) };
    });
}

/**
 * The chain head: the hashed entry no other entry names as its predecessor. The chain
 * is defined by its links, never by filename order — filenames carry the minute a
 * convening STARTED, so parallel convenings, same-minute questions, and `-2` collision
 * suffixes all sort differently from the order they were written in.
 */
function latestLedgerHash(dir: string): string {
  if (!existsSync(dir)) return GENESIS_SHA256;
  const hashed = readChainRecords(dir).filter((r) => r.content && /^[0-9a-f]{64}$/.test(r.content));
  if (hashed.length === 0) return GENESIS_SHA256;
  const named = new Set(hashed.map((r) => r.prev));
  const tips = hashed.filter((r) => !named.has(r.content));
  // More than one tip means the chain already forked (verifyLedger reports it); extend
  // the latest-named branch. No tip at all is a cycle — fall back to the last file.
  return (tips[tips.length - 1] ?? hashed[hashed.length - 1]).content as string;
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
 * Verifies the SHA-256 hash chain across all `.md` ledger files in `dir`. Each entry's
 * `content_sha256` is recomputed, and the entries must form one unbroken line of
 * `prev_sha256` links from genesis — followed by link, not by filename order (see
 * `latestLedgerHash`). Pre-v0.9 entries that sort ahead of the first chained record are
 * skipped cleanly; an unhashed file after it, a dangling link, or a fork is an error.
 */
export function verifyLedger(dir: string = ledgerDir()): LedgerVerification {
  if (!existsSync(dir)) {
    return { valid: true, checked: 0, legacySkipped: 0, headSha256: GENESIS_SHA256, errors: [] };
  }

  const records = readChainRecords(dir);
  const errors: string[] = [];
  const complete: Array<ChainRecord & { prev: string; content: string }> = [];
  let chainStarted = false;
  let checked = 0;
  let legacySkipped = 0;

  for (const record of records) {
    if (!record.prev && !record.content) {
      if (chainStarted) {
        errors.push(`${record.file}: missing prev_sha256/content_sha256 after hash chain started`);
      } else {
        legacySkipped++;
      }
      continue;
    }

    chainStarted = true;
    checked++;

    if (!record.prev || !record.content) {
      errors.push(`${record.file}: incomplete hash-chain frontmatter`);
      continue;
    }

    const recomputed = sha256Hex(canonicalizeForHash(record.raw));
    if (record.content !== recomputed) {
      errors.push(
        `${record.file}: tampered content — content_sha256 is ${record.content}, recomputed ${recomputed}`,
      );
    }
    complete.push(record as ChainRecord & { prev: string; content: string });
  }

  // Walk the links from genesis. Every complete entry must be reached exactly once.
  const successors = new Map<string, typeof complete>();
  for (const record of complete) {
    const list = successors.get(record.prev) ?? [];
    list.push(record);
    successors.set(record.prev, list);
  }
  const reached = new Set<string>();
  let headSha256 = GENESIS_SHA256;
  for (let next = successors.get(headSha256); next && !reached.has(next[0].file); next = successors.get(headSha256)) {
    if (next.length > 1) {
      errors.push(
        `forked chain — ${next.map((r) => r.file).join(" and ")} all name ${headSha256} as prev_sha256`,
      );
      for (const sibling of next) reached.add(sibling.file);
    }
    reached.add(next[0].file);
    headSha256 = next[0].content;
  }
  for (const record of complete) {
    if (!reached.has(record.file)) {
      errors.push(
        `${record.file}: broken chain — prev_sha256 is ${record.prev}, which does not lead back to genesis`,
      );
    }
  }

  return { valid: errors.length === 0, checked, legacySkipped, headSha256, errors };
}
