import { describe, expect, it } from "vitest";
import {
  ADVISOR_PROMPT_OVERHEAD_TOKENS,
  ADVISOR_TOKENS,
  catalogSchema,
  loadCatalog,
  MAX_SYNTH_TOKENS,
  planCouncil,
  SYNTH_PROMPT_OVERHEAD_TOKENS,
  type Catalog,
} from "../src/router.js";

/** Fixture catalog with the real shape but hand-picked prices; live price edits never break tests. */
const FIXTURE: Catalog = {
  schema: "symposium-models/v1",
  verified: "2026-01-01",
  models: [
    { id: "anthro-low", provider: "anthropic", tier: "low", in_per_mtok: 1, out_per_mtok: 5 },
    { id: "anthro-med", provider: "anthropic", tier: "medium", in_per_mtok: 3, out_per_mtok: 15 },
    { id: "anthro-high", provider: "anthropic", tier: "high", in_per_mtok: 5, out_per_mtok: 25 },
    { id: "oai-low", provider: "openai", tier: "low", in_per_mtok: 0.2, out_per_mtok: 1.2 },
    { id: "oai-med", provider: "openai", tier: "medium", in_per_mtok: 2, out_per_mtok: 12 },
    { id: "oai-high", provider: "openai", tier: "high", in_per_mtok: 5, out_per_mtok: 30 },
    { id: "goog-low", provider: "google", tier: "low", in_per_mtok: 0.3, out_per_mtok: 2.5 },
    { id: "goog-med", provider: "google", tier: "medium", in_per_mtok: 1.5, out_per_mtok: 7.5 },
    { id: "goog-high", provider: "google", tier: "high", in_per_mtok: 2, out_per_mtok: 12 },
    { id: "xai-low", provider: "xai", tier: "low", in_per_mtok: 1, out_per_mtok: 2 },
    { id: "xai-med", provider: "xai", tier: "medium", in_per_mtok: 1.25, out_per_mtok: 2.5 },
    { id: "xai-high", provider: "xai", tier: "high", in_per_mtok: 2, out_per_mtok: 6 },
    { id: "ds-low", provider: "deepseek", tier: "low", in_per_mtok: 0.14, out_per_mtok: 0.28 },
    { id: "ds-med", provider: "deepseek", tier: "medium", in_per_mtok: 0.435, out_per_mtok: 0.87 },
    { id: "ds-high", provider: "deepseek", tier: "high", in_per_mtok: 0.435, out_per_mtok: 0.87 },
  ],
};

const ALL_KEYS = {
  ANTHROPIC_API_KEY: "k1",
  OPENAI_API_KEY: "k2",
  GEMINI_API_KEY: "k3",
  XAI_API_KEY: "k4",
};

// 400 chars -> exactly 100 estimated tokens
const QUESTION = "q".repeat(400);
const BIG_BUDGET = 999;

function plan(
  overrides: Partial<Parameters<typeof planCouncil>[0]> = {},
  env: Record<string, string | undefined> = ALL_KEYS,
) {
  return planCouncil(
    { question: QUESTION, stakes: "medium", budget_usd: BIG_BUDGET, ...overrides },
    env,
    FIXTURE,
  );
}

describe("stakes → tier mapping", () => {
  it.each([
    ["low", "low"],
    ["medium", "medium"],
    ["high", "high"],
    ["audited", "high"],
  ] as const)("stakes %s selects tier %s", (stakes, tier) => {
    const p = plan({ stakes });
    expect(p.requestedTier).toBe(tier);
    expect(p.tier).toBe(tier);
    expect(p.downgraded).toBe(false);
  });
});

describe("cost estimate", () => {
  it("matches the hand-computed value (low tier, 4 of 5 advisors keyed)", () => {
    const p = plan({ stakes: "low" });

    const promptTokens = 100 + ADVISOR_PROMPT_OVERHEAD_TOKENS; // 500
    const advisorCost = (model: { in: number; out: number }) =>
      (promptTokens / 1e6) * model.in + (ADVISOR_TOKENS.low / 1e6) * model.out;
    // Synth tier is medium (one above low); cheapest medium synth call is xai-med
    // (no DeepSeek key in ALL_KEYS, so ds-med is not a candidate).
    const synthPromptTokens = 4 * ADVISOR_TOKENS.low + 100 + SYNTH_PROMPT_OVERHEAD_TOKENS;
    const synthCost = (synthPromptTokens / 1e6) * 1.25 + (MAX_SYNTH_TOKENS / 1e6) * 2.5;

    const expected =
      advisorCost({ in: 1, out: 5 }) + // anthro-low
      advisorCost({ in: 0.2, out: 1.2 }) + // oai-low
      advisorCost({ in: 0.3, out: 2.5 }) + // goog-low
      advisorCost({ in: 1, out: 2 }) + // xai-low
      synthCost;

    expect(p.estimateUsd).toBeCloseTo(expected, 10);
    expect(p.advisors.map((a) => a.modelId)).toEqual([
      "anthro-low",
      "oai-low",
      "goog-low",
      "xai-low",
      null, // DeepSeek — no key
    ]);
  });

  it("uses larger advisor output budgets at higher tiers", () => {
    expect(ADVISOR_TOKENS.low).toBeLessThan(ADVISOR_TOKENS.medium);
    expect(ADVISOR_TOKENS.medium).toBeLessThan(ADVISOR_TOKENS.high);
    // Same tier prices, bigger budget -> high estimate strictly exceeds a
    // hypothetical high estimate computed at the low budget.
    const high = plan({ stakes: "high" });
    expect(high.estimateUsd).toBeGreaterThan(0);
  });

  it("estimate excludes advisors whose key is missing", () => {
    // Drop OpenAI, not Google: Google is the cheapest synth provider, and removing
    // it forces a pricier synthesizer — the total can legitimately go UP.
    const withAll = plan({ stakes: "low" });
    const withTwo = plan({ stakes: "low" }, { ...ALL_KEYS, OPENAI_API_KEY: undefined as never });
    expect(withTwo.estimateUsd).toBeLessThan(withAll.estimateUsd);
  });
});

describe("budget defaults and overrides", () => {
  it.each([
    ["low", 0.1],
    ["medium", 0.25],
    ["high", 1.0],
    ["audited", 1.0],
  ] as const)("stakes %s defaults to $%d", (stakes, budget) => {
    const p = plan({ stakes, budget_usd: undefined });
    expect(p.budgetUsd).toBe(budget);
  });

  it("explicit budget_usd wins over the stakes default", () => {
    expect(plan({ budget_usd: 0.42 }).budgetUsd).toBe(0.42);
  });
});

describe("downgrade and refusal", () => {
  it("downgrades one tier when the estimate exceeds the budget", () => {
    const high = plan({ stakes: "high" });
    const medium = plan({ stakes: "medium" });
    // Between the medium and high estimates: high must downgrade to medium.
    const budget = (medium.estimateUsd + high.estimateUsd) / 2;

    const p = plan({ stakes: "high", budget_usd: budget });
    expect(p.refusal).toBeUndefined();
    expect(p.requestedTier).toBe("high");
    expect(p.tier).toBe("medium");
    expect(p.downgraded).toBe(true);
    expect(p.estimateUsd).toBeCloseTo(medium.estimateUsd, 10);
  });

  it("refuses with the floor-tier estimate when even low exceeds the budget", () => {
    const p = plan({ stakes: "high", budget_usd: 0.000001 });
    expect(p.refusal).toBeDefined();
    expect(p.refusal).toContain("lowest tier");
    expect(p.refusal).toContain(`$${p.estimateUsd.toFixed(4)}`);
    expect(p.tier).toBe("low"); // walked all the way down before refusing
    expect(p.downgraded).toBe(false);
  });
});

describe("advisor availability", () => {
  it("proceeds with remaining advisors and a notice when one key is missing", () => {
    const p = plan({}, { ...ALL_KEYS, GEMINI_API_KEY: undefined as never });
    expect(p.refusal).toBeUndefined();
    const gemini = p.advisors.find((a) => a.name === "Gemini")!;
    expect(gemini.available).toBe(false);
    expect(gemini.modelId).toBeNull();
    expect(gemini.notice).toContain("GEMINI_API_KEY");
    expect(p.advisors.filter((a) => a.available)).toHaveLength(3);
  });

  it("refuses with fewer than 2 advisors, naming the missing keys", () => {
    const p = plan({}, { ANTHROPIC_API_KEY: "k1" } as typeof ALL_KEYS);
    expect(p.refusal).toBeDefined();
    expect(p.refusal).toContain("at least 2");
    expect(p.refusal).toContain("OPENAI_API_KEY");
    expect(p.refusal).toContain("GEMINI_API_KEY");
    expect(p.refusal).toContain("XAI_API_KEY");
  });
});

describe("synthesizer selection", () => {
  it("picks the cheapest model one tier above the advisors", () => {
    // Advisors low -> synth medium; xai-med is the cheapest medium.
    expect(plan({ stakes: "low" }).synthModelId).toBe("xai-med");
  });

  it("clamps to the cheapest top-tier model when advisors are already high", () => {
    // No tier above high; xai-high is the cheapest high.
    expect(plan({ stakes: "high" }).synthModelId).toBe("xai-high");
  });

  it("only considers synth models from providers with keys", () => {
    const p = plan({ stakes: "low" }, { ...ALL_KEYS, XAI_API_KEY: undefined as never });
    expect(p.synthModelId).toBe("goog-med"); // xai-med excluded; goog-med is next-cheapest
  });

  it("DeepSeek becomes the synthesizer once its key exists (cheapest at every tier)", () => {
    const p = plan({ stakes: "low" }, { ...ALL_KEYS, DEEPSEEK_API_KEY: "k5" });
    expect(p.advisors.filter((a) => a.available)).toHaveLength(5);
    expect(p.synthModelId).toBe("ds-med");
  });
});

describe("live models.json", () => {
  it("parses and validates against the catalog schema", () => {
    const catalog = loadCatalog();
    expect(catalog.schema).toBe("symposium-models/v1");
    // One model per provider per tier — the estimator depends on this shape.
    for (const provider of ["anthropic", "openai", "google", "xai", "deepseek"] as const) {
      for (const tier of ["low", "medium", "high"] as const) {
        expect(
          catalog.models.filter((m) => m.provider === provider && m.tier === tier),
          `${provider}/${tier}`,
        ).toHaveLength(1);
      }
    }
    expect(() => catalogSchema.parse({ schema: "wrong" })).toThrow();
  });
});

describe("retained seats (SYMPOSIUM_RETAINED_SEATS)", () => {
  it("plans no retained rows when the env var is unset", () => {
    expect(plan().advisors).toHaveLength(5);
  });

  it("adds opted-in seats with retained provenance and no estimate impact", () => {
    const base = plan({ stakes: "low" });
    const p = planCouncil(
      { question: QUESTION, stakes: "low", budget_usd: BIG_BUDGET },
      { ...ALL_KEYS, SYMPOSIUM_RETAINED_SEATS: "claude, codex" },
      FIXTURE,
      { claude: true, codex: true },
    );
    expect(p.advisors).toHaveLength(7);
    const cc = p.advisors.find((a) => a.name === "Claude Code")!;
    expect(cc.provenance).toBe("retained");
    expect(cc.available).toBe(true);
    expect(cc.modelId).toBe("claude-code");
    expect(p.advisors.find((a) => a.name === "Codex")?.modelId).toBe("codex");
    // Flat tier: retained seats add exactly nothing to the metered estimate.
    expect(p.estimateUsd).toBeCloseTo(base.estimateUsd, 10);
    // Every neutral seat keeps neutral provenance.
    expect(p.advisors.filter((a) => a.provenance === "neutral")).toHaveLength(5);
  });

  it("marks an opted-in seat skipped when its CLI is not on PATH", () => {
    const p = planCouncil(
      { question: QUESTION, stakes: "medium", budget_usd: BIG_BUDGET },
      { ...ALL_KEYS, SYMPOSIUM_RETAINED_SEATS: "gemini" },
      FIXTURE,
      {}, // gemini never detected
    );
    const seat = p.advisors.find((a) => a.name === "Gemini CLI")!;
    expect(seat.available).toBe(false);
    expect(seat.modelId).toBeNull();
    expect(seat.notice).toContain("gemini CLI not found on PATH");
    expect(p.refusal).toBeUndefined(); // four keyed advisors still hold quorum
  });

  it("counts retained seats toward the >= 2 quorum", () => {
    const p = planCouncil(
      { question: QUESTION, stakes: "medium", budget_usd: BIG_BUDGET },
      { ANTHROPIC_API_KEY: "k1", SYMPOSIUM_RETAINED_SEATS: "claude" },
      FIXTURE,
      { claude: true },
    );
    expect(p.refusal).toBeUndefined();
    expect(p.advisors.filter((a) => a.available)).toHaveLength(2);
  });

  it("surfaces unknown tokens as plan notices without refusing", () => {
    const p = planCouncil(
      { question: QUESTION, stakes: "medium", budget_usd: BIG_BUDGET },
      { ...ALL_KEYS, SYMPOSIUM_RETAINED_SEATS: "claude,oracle" },
      FIXTURE,
      { claude: true },
    );
    expect(p.refusal).toBeUndefined();
    expect(p.notices).toHaveLength(1);
    expect(p.notices[0]).toContain('"oracle"');
  });

  it("mentions the retained opt-in in a quorum refusal", () => {
    const p = plan({}, { ANTHROPIC_API_KEY: "k1" } as typeof ALL_KEYS);
    expect(p.refusal).toContain("SYMPOSIUM_RETAINED_SEATS");
  });
});
