import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Stakes } from "./ledger.js";

export type Tier = "low" | "medium" | "high";
/** API-key providers with $/Mtok pricing in the catalog. */
export type MeteredProvider = "anthropic" | "openai" | "google" | "xai" | "deepseek" | "openrouter";
/** Subscription-CLI providers — no API billing, flat $0 in the router (spec: retained seats). */
export type RetainedProvider = "claude-cli" | "codex-cli" | "gemini-cli";
export type Provider = MeteredProvider | RetainedProvider;
export type AdvisorName =
  | "Claude"
  | "GPT"
  | "Gemini"
  | "Grok"
  | "DeepSeek"
  | "Qwen"
  | "Claude Code"
  | "Codex"
  | "Gemini CLI";
/**
 * Seat provenance (ledger schema v3): `retained` = an official subscription CLI carrying
 * its human's context — informed-but-interested counsel; `neutral` = a cold API seat.
 * Provenance discloses, it does not rank.
 */
export type Provenance = "neutral" | "retained";

const modelEntrySchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["anthropic", "openai", "google", "xai", "deepseek", "openrouter"]),
  tier: z.enum(["low", "medium", "high"]),
  in_per_mtok: z.number().positive(),
  out_per_mtok: z.number().positive(),
});

/**
 * One-key council: a voice whose native key is absent can sit via OpenRouter
 * (the seat-election council's ruling — fallback only, never for keyed anchors).
 * `voice` is the home provider the row substitutes for; billing is OpenRouter's.
 */
const fallbackEntrySchema = z.object({
  voice: z.enum(["anthropic", "openai", "google", "xai", "deepseek"]),
  tier: z.enum(["low", "medium", "high"]),
  id: z.string().min(1),
  in_per_mtok: z.number().positive(),
  out_per_mtok: z.number().positive(),
});

export const catalogSchema = z.object({
  schema: z.literal("symposium-models/v1"),
  verified: z.string().min(1),
  models: z.array(modelEntrySchema).min(1),
  openrouter_fallbacks: z.array(fallbackEntrySchema).optional(),
});

export type FallbackEntry = z.infer<typeof fallbackEntrySchema>;

export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type Catalog = z.infer<typeof catalogSchema>;

/** The minimum a seat needs for cost accounting; retained seats price at 0/0. */
export interface Priced {
  id: string;
  in_per_mtok: number;
  out_per_mtok: number;
}

/** Loads and validates src/models.json; throws on a malformed catalog (fail fast at startup). */
export function loadCatalog(): Catalog {
  const path = join(dirname(fileURLToPath(import.meta.url)), "models.json");
  return catalogSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export const ADVISORS: ReadonlyArray<{ name: AdvisorName; provider: MeteredProvider; envKey: string }> = [
  { name: "Claude", provider: "anthropic", envKey: "ANTHROPIC_API_KEY" },
  { name: "GPT", provider: "openai", envKey: "OPENAI_API_KEY" },
  { name: "Gemini", provider: "google", envKey: "GEMINI_API_KEY" },
  { name: "Grok", provider: "xai", envKey: "XAI_API_KEY" },
  { name: "DeepSeek", provider: "deepseek", envKey: "DEEPSEEK_API_KEY" },
  { name: "Qwen", provider: "openrouter", envKey: "OPENROUTER_API_KEY" },
];

/** Opt-in tokens for SYMPOSIUM_RETAINED_SEATS (comma/space separated). */
export type RetainedToken = "claude" | "codex" | "gemini";

export interface RetainedSeatSpec {
  token: RetainedToken;
  name: AdvisorName;
  provider: RetainedProvider;
  /** The binary invoked as a subprocess; the seat skips when it is not on PATH. */
  command: string;
  /** The id recorded in ledgers and plans in place of a model id. */
  cliId: string;
}

export const RETAINED_SEATS: ReadonlyArray<RetainedSeatSpec> = [
  { token: "claude", name: "Claude Code", provider: "claude-cli", command: "claude", cliId: "claude-code" },
  { token: "codex", name: "Codex", provider: "codex-cli", command: "codex", cliId: "codex" },
  { token: "gemini", name: "Gemini CLI", provider: "gemini-cli", command: "gemini", cliId: "gemini-cli" },
];

/** Flat pricing for a retained seat: no API billing. NOT "zero cost" — quotas and ToS are real. */
export function retainedPriced(provider: RetainedProvider): Priced {
  const seat = RETAINED_SEATS.find((s) => s.provider === provider);
  if (!seat) throw new Error(`no retained seat for provider ${provider}`);
  return { id: seat.cliId, in_per_mtok: 0, out_per_mtok: 0 };
}

export function parseRetainedTokens(raw: string | undefined): {
  tokens: RetainedToken[];
  unknown: string[];
} {
  if (!raw) return { tokens: [], unknown: [] };
  const known = new Set<string>(RETAINED_SEATS.map((s) => s.token));
  const tokens: RetainedToken[] = [];
  const unknown: string[] = [];
  for (const part of raw.split(/[,\s]+/).map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (known.has(part)) {
      if (!tokens.includes(part as RetainedToken)) tokens.push(part as RetainedToken);
    } else {
      unknown.push(part);
    }
  }
  return { tokens, unknown };
}

/**
 * Max output tokens per advisor, by tier. Frontier models spend output tokens on
 * internal reasoning we cannot always disable (P4 gate: Gemini 3.1 Pro malformed twice
 * at 1024) — higher tiers get headroom so thinking doesn't truncate the JSON contract.
 */
export const ADVISOR_TOKENS: Record<Tier, number> = { low: 1024, medium: 2048, high: 4096 };
/**
 * Max output tokens for the synthesizer (DISSENT table quotes advisors verbatim).
 * Sized with thinking headroom: frontier synth models reason before writing, and those
 * tokens bill as output — at 2048 the first live convening truncated mid-DISSENT.
 */
export const MAX_SYNTH_TOKENS = 8192;
/** Fixed instruction overhead added to the question when estimating an advisor prompt. */
export const ADVISOR_PROMPT_OVERHEAD_TOKENS = 400;
/** Fixed overhead for the synthesis rules prompt. */
export const SYNTH_PROMPT_OVERHEAD_TOKENS = 300;

export const DEFAULT_BUDGET_USD: Record<Stakes, number> = {
  low: 0.1, // must clear the floor-tier estimate incl. synth thinking headroom
  medium: 0.25,
  high: 1.0,
  audited: 1.0,
};

const STAKES_TIER: Record<Stakes, Tier> = {
  low: "low",
  medium: "medium",
  high: "high",
  audited: "high",
};

/** Synthesis runs one tier above the advisors; at the top there is no tier above, so clamp. */
const SYNTH_TIER: Record<Tier, Tier> = { low: "medium", medium: "high", high: "high" };

const TIER_BELOW: Record<Tier, Tier | null> = { high: "medium", medium: "low", low: null };

/** chars/4 heuristic — deliberately crude; the hard cap is enforced against actual usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface PlanInput {
  question: string;
  context?: string;
  stakes: Stakes;
  budget_usd?: number;
}

export interface AdvisorPlan {
  name: AdvisorName;
  provider: Provider;
  provenance: Provenance;
  available: boolean;
  /** Selected model id (or CLI id for retained seats) when available; null when skipped. */
  modelId: string | null;
  notice?: string;
}

export interface CouncilPlan {
  requestedTier: Tier;
  tier: Tier;
  downgraded: boolean;
  advisors: AdvisorPlan[];
  synthModelId: string | null;
  /** Synth candidates ranked cheapest-first; the council falls back down this list. */
  synthCandidateIds: string[];
  estimateUsd: number;
  budgetUsd: number;
  /** Plan-level warnings (e.g. unknown retained seat tokens); empty when clean. */
  notices: string[];
  refusal?: string;
}

function modelFor(catalog: Catalog, provider: MeteredProvider, tier: Tier): ModelEntry {
  const entry = catalog.models.find((m) => m.provider === provider && m.tier === tier);
  if (!entry) throw new Error(`models.json has no entry for provider=${provider} tier=${tier}`);
  return entry;
}

/** A fallback row materialized as a billable entry — OpenRouter is what bills. */
export function fallbackFor(
  catalog: Catalog,
  voice: MeteredProvider,
  tier: Tier,
): ModelEntry | null {
  const row = catalog.openrouter_fallbacks?.find((f) => f.voice === voice && f.tier === tier);
  return row
    ? {
        id: row.id,
        provider: "openrouter",
        tier: row.tier,
        in_per_mtok: row.in_per_mtok,
        out_per_mtok: row.out_per_mtok,
      }
    : null;
}

/** A voice is fallback-eligible only with rows at every tier — the budget walk changes tiers. */
export function hasCompleteFallback(catalog: Catalog, voice: MeteredProvider): boolean {
  return (["low", "medium", "high"] as const).every((t) => fallbackFor(catalog, voice, t) !== null);
}

/** Resolves any billable id — catalog models or OpenRouter fallback rows. */
export function findPriced(catalog: Catalog, id: string): ModelEntry {
  const native = catalog.models.find((m) => m.id === id);
  if (native) return native;
  const row = catalog.openrouter_fallbacks?.find((f) => f.id === id);
  if (row)
    return {
      id: row.id,
      provider: "openrouter",
      tier: row.tier,
      in_per_mtok: row.in_per_mtok,
      out_per_mtok: row.out_per_mtok,
    };
  throw new Error(`model ${id} not found in catalog`);
}

function callCost(model: ModelEntry, promptTokens: number, maxOutputTokens: number): number {
  return (promptTokens / 1e6) * model.in_per_mtok + (maxOutputTokens / 1e6) * model.out_per_mtok;
}

interface TierEstimate {
  estimateUsd: number;
  advisorModels: Map<AdvisorName, ModelEntry>;
  synthModel: ModelEntry | null;
  /** All synth candidates, cheapest first — the council falls back down this list. */
  synthCandidates: ModelEntry[];
}

/** How a metered seat sits: on its own key, or routed via OpenRouter (no native key). */
interface SeatSpec {
  name: AdvisorName;
  voice: MeteredProvider;
  mode: "native" | "fallback";
}

function seatEntry(catalog: Catalog, seat: SeatSpec, tier: Tier): ModelEntry | null {
  return seat.mode === "native"
    ? modelFor(catalog, seat.voice, tier)
    : fallbackFor(catalog, seat.voice, tier);
}

function estimateTier(
  catalog: Catalog,
  tier: Tier,
  seats: SeatSpec[],
  questionTokens: number,
): TierEstimate {
  const advisorPromptTokens = questionTokens + ADVISOR_PROMPT_OVERHEAD_TOKENS;
  const advisorModels = new Map<AdvisorName, ModelEntry>();
  let total = 0;
  for (const seat of seats) {
    const model = seatEntry(catalog, seat, tier);
    if (!model) continue;
    advisorModels.set(seat.name, model);
    total += callCost(model, advisorPromptTokens, ADVISOR_TOKENS[tier]);
  }

  const synthPromptTokens =
    advisorModels.size * ADVISOR_TOKENS[tier] + questionTokens + SYNTH_PROMPT_OVERHEAD_TOKENS;
  const seen = new Set<string>();
  const synthCandidates: ModelEntry[] = [];
  for (const seat of seats) {
    const m = seatEntry(catalog, seat, SYNTH_TIER[tier]);
    if (m && !seen.has(m.id)) {
      seen.add(m.id);
      synthCandidates.push(m);
    }
  }
  synthCandidates.sort(
    (a, b) =>
      callCost(a, synthPromptTokens, MAX_SYNTH_TOKENS) -
      callCost(b, synthPromptTokens, MAX_SYNTH_TOKENS),
  );
  const synthModel = synthCandidates[0] ?? null;
  if (synthModel) total += callCost(synthModel, synthPromptTokens, MAX_SYNTH_TOKENS);

  return { estimateUsd: total, advisorModels, synthModel, synthCandidates };
}

/**
 * Pure pre-flight planner: tier selection, cost estimate, budget downgrade/refusal,
 * advisor availability. No provider is ever called here.
 */
export function planCouncil(
  input: PlanInput,
  env: Record<string, string | undefined>,
  catalog: Catalog,
  /** Which opted-in retained CLIs were actually found on PATH (detected by the caller). */
  cliAvailable: Partial<Record<RetainedToken, boolean>> = {},
): CouncilPlan {
  const requestedTier = STAKES_TIER[input.stakes];
  const budgetUsd = input.budget_usd ?? DEFAULT_BUDGET_USD[input.stakes];
  const questionTokens = estimateTokens(input.question + (input.context ?? ""));

  const orKeyed = Boolean(env.OPENROUTER_API_KEY);
  const seats: SeatSpec[] = [];
  const neutralAdvisors: AdvisorPlan[] = ADVISORS.map(({ name, provider, envKey }) => {
    if (env[envKey]) {
      seats.push({ name, voice: provider, mode: "native" });
      return { name, provider, provenance: "neutral" as const, available: true, modelId: null };
    }
    // One key, full council: a voice without its native key sits via OpenRouter —
    // fallback only, never for keyed anchors (the seat-election council's ruling).
    if (orKeyed && provider !== "openrouter" && hasCompleteFallback(catalog, provider)) {
      seats.push({ name, voice: provider, mode: "fallback" });
      return {
        name,
        provider: "openrouter" as const,
        provenance: "neutral" as const,
        available: true,
        modelId: null,
        notice: `via OpenRouter — no ${envKey} set`,
      };
    }
    return {
      name,
      provider,
      provenance: "neutral" as const,
      available: false,
      modelId: null,
      notice: `skipped — no ${envKey} set`,
    };
  });

  // Retained seats join only by explicit opt-in — a subscription CLI is never invoked unasked.
  const { tokens: retainedTokens, unknown } = parseRetainedTokens(env.SYMPOSIUM_RETAINED_SEATS);
  const retainedAdvisors: AdvisorPlan[] = retainedTokens.map((token) => {
    const seat = RETAINED_SEATS.find((s) => s.token === token)!;
    const available = cliAvailable[token] === true;
    return {
      name: seat.name,
      provider: seat.provider,
      provenance: "retained" as const,
      available,
      modelId: available ? seat.cliId : null,
      ...(available ? {} : { notice: `skipped — ${seat.command} CLI not found on PATH` }),
    };
  });
  const notices = unknown.map(
    (u) => `unknown retained seat token "${u}" ignored (known: claude, codex, gemini)`,
  );

  const advisors = [...neutralAdvisors, ...retainedAdvisors];

  // Walk down from the requested tier until the estimate fits the budget.
  // Retained seats are flat $0 in the estimate and neither downgrade nor refuse.
  let tier = requestedTier;
  let estimate = estimateTier(catalog, tier, seats, questionTokens);
  let refusal: string | undefined;
  while (estimate.estimateUsd > budgetUsd) {
    const below = TIER_BELOW[tier];
    if (!below) {
      refusal =
        `estimated cost $${estimate.estimateUsd.toFixed(4)} exceeds the budget ` +
        `$${budgetUsd.toFixed(4)} even at the lowest tier`;
      break;
    }
    tier = below;
    estimate = estimateTier(catalog, tier, seats, questionTokens);
  }

  for (const advisor of neutralAdvisors) {
    if (advisor.available) advisor.modelId = estimate.advisorModels.get(advisor.name)?.id ?? null;
  }

  // A council of one is a monologue: require >= 2 seats (spec §3); retained seats count.
  const availableSeats = advisors.filter((a) => a.available).length;
  if (availableSeats < 2) {
    const missing = ADVISORS.filter(({ envKey }) => !env[envKey]).map(({ envKey }) => envKey);
    refusal =
      `only ${availableSeats} advisor(s) available; the council requires at least 2. ` +
      `Missing keys: ${missing.join(", ")}. ` +
      `Retained seats can also be opted in via SYMPOSIUM_RETAINED_SEATS (claude, codex, gemini)`;
  }

  return {
    requestedTier,
    tier,
    downgraded: tier !== requestedTier && !refusal,
    advisors,
    synthModelId: estimate.synthModel?.id ?? null,
    synthCandidateIds: estimate.synthCandidates.map((m) => m.id),
    estimateUsd: estimate.estimateUsd,
    budgetUsd,
    notices,
    ...(refusal ? { refusal: `Council refused: ${refusal}.` } : {}),
  };
}
