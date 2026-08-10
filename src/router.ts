import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Stakes } from "./ledger.js";

export type Tier = "low" | "medium" | "high";
export type Provider = "anthropic" | "openai" | "google" | "xai" | "deepseek";
export type AdvisorName = "Claude" | "GPT" | "Gemini" | "Grok" | "DeepSeek";

const modelEntrySchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["anthropic", "openai", "google", "xai", "deepseek"]),
  tier: z.enum(["low", "medium", "high"]),
  in_per_mtok: z.number().positive(),
  out_per_mtok: z.number().positive(),
});

export const catalogSchema = z.object({
  schema: z.literal("symposium-models/v1"),
  verified: z.string().min(1),
  models: z.array(modelEntrySchema).min(1),
});

export type ModelEntry = z.infer<typeof modelEntrySchema>;
export type Catalog = z.infer<typeof catalogSchema>;

/** Loads and validates src/models.json; throws on a malformed catalog (fail fast at startup). */
export function loadCatalog(): Catalog {
  const path = join(dirname(fileURLToPath(import.meta.url)), "models.json");
  return catalogSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export const ADVISORS: ReadonlyArray<{ name: AdvisorName; provider: Provider; envKey: string }> = [
  { name: "Claude", provider: "anthropic", envKey: "ANTHROPIC_API_KEY" },
  { name: "GPT", provider: "openai", envKey: "OPENAI_API_KEY" },
  { name: "Gemini", provider: "google", envKey: "GEMINI_API_KEY" },
  { name: "Grok", provider: "xai", envKey: "XAI_API_KEY" },
  { name: "DeepSeek", provider: "deepseek", envKey: "DEEPSEEK_API_KEY" },
];

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
  available: boolean;
  /** Selected model id when available; null when the advisor is skipped. */
  modelId: string | null;
  notice?: string;
}

export interface CouncilPlan {
  requestedTier: Tier;
  tier: Tier;
  downgraded: boolean;
  advisors: AdvisorPlan[];
  synthModelId: string | null;
  estimateUsd: number;
  budgetUsd: number;
  refusal?: string;
}

function modelFor(catalog: Catalog, provider: Provider, tier: Tier): ModelEntry {
  const entry = catalog.models.find((m) => m.provider === provider && m.tier === tier);
  if (!entry) throw new Error(`models.json has no entry for provider=${provider} tier=${tier}`);
  return entry;
}

function callCost(model: ModelEntry, promptTokens: number, maxOutputTokens: number): number {
  return (promptTokens / 1e6) * model.in_per_mtok + (maxOutputTokens / 1e6) * model.out_per_mtok;
}

interface TierEstimate {
  estimateUsd: number;
  advisorModels: Map<Provider, ModelEntry>;
  synthModel: ModelEntry | null;
}

function estimateTier(
  catalog: Catalog,
  tier: Tier,
  availableProviders: Provider[],
  questionTokens: number,
): TierEstimate {
  const advisorPromptTokens = questionTokens + ADVISOR_PROMPT_OVERHEAD_TOKENS;
  const advisorModels = new Map<Provider, ModelEntry>();
  let total = 0;
  for (const provider of availableProviders) {
    const model = modelFor(catalog, provider, tier);
    advisorModels.set(provider, model);
    total += callCost(model, advisorPromptTokens, ADVISOR_TOKENS[tier]);
  }

  const synthPromptTokens =
    availableProviders.length * ADVISOR_TOKENS[tier] + questionTokens + SYNTH_PROMPT_OVERHEAD_TOKENS;
  const synthCandidates = catalog.models.filter(
    (m) => m.tier === SYNTH_TIER[tier] && availableProviders.includes(m.provider),
  );
  let synthModel: ModelEntry | null = null;
  for (const candidate of synthCandidates) {
    if (
      !synthModel ||
      callCost(candidate, synthPromptTokens, MAX_SYNTH_TOKENS) <
        callCost(synthModel, synthPromptTokens, MAX_SYNTH_TOKENS)
    ) {
      synthModel = candidate;
    }
  }
  if (synthModel) total += callCost(synthModel, synthPromptTokens, MAX_SYNTH_TOKENS);

  return { estimateUsd: total, advisorModels, synthModel };
}

/**
 * Pure pre-flight planner: tier selection, cost estimate, budget downgrade/refusal,
 * advisor availability. No provider is ever called here.
 */
export function planCouncil(
  input: PlanInput,
  env: Record<string, string | undefined>,
  catalog: Catalog,
): CouncilPlan {
  const requestedTier = STAKES_TIER[input.stakes];
  const budgetUsd = input.budget_usd ?? DEFAULT_BUDGET_USD[input.stakes];
  const questionTokens = estimateTokens(input.question + (input.context ?? ""));

  const advisors: AdvisorPlan[] = ADVISORS.map(({ name, provider, envKey }) => {
    const available = Boolean(env[envKey]);
    return {
      name,
      provider,
      available,
      modelId: null,
      ...(available ? {} : { notice: `skipped — no ${envKey} set` }),
    };
  });
  const availableProviders = advisors.filter((a) => a.available).map((a) => a.provider);

  // Walk down from the requested tier until the estimate fits the budget.
  let tier = requestedTier;
  let estimate = estimateTier(catalog, tier, availableProviders, questionTokens);
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
    estimate = estimateTier(catalog, tier, availableProviders, questionTokens);
  }

  for (const advisor of advisors) {
    if (advisor.available) advisor.modelId = estimate.advisorModels.get(advisor.provider)?.id ?? null;
  }

  // A council of one is a monologue: require >= 2 advisors (spec §3).
  if (availableProviders.length < 2) {
    const missing = ADVISORS.filter(({ envKey }) => !env[envKey]).map(({ envKey }) => envKey);
    refusal =
      `only ${availableProviders.length} advisor(s) available; the council requires at least 2. ` +
      `Missing keys: ${missing.join(", ")}`;
  }

  return {
    requestedTier,
    tier,
    downgraded: tier !== requestedTier && !refusal,
    advisors,
    synthModelId: estimate.synthModel?.id ?? null,
    estimateUsd: estimate.estimateUsd,
    budgetUsd,
    ...(refusal ? { refusal: `Council refused: ${refusal}.` } : {}),
  };
}
