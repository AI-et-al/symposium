import { describe, expect, it } from "vitest";
import {
  advisorPrompt,
  conveneCouncil,
  parseReply,
  parseVerdicts,
  redactSecrets,
  runAdvisor,
  splitSynthOutput,
  stripFences,
  type CostCap,
} from "../src/council.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import { ADVISOR_JSON_SCHEMA } from "../src/providers/google.js";
import { planCouncil, type Catalog, type Provider } from "../src/router.js";

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
  ],
};

const ALL_KEYS = { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", GEMINI_API_KEY: "k" };

const VALID_REPLY = JSON.stringify({
  position: "Yes, with caveats.",
  confidence: 0.7,
  key_uncertainties: ["identity persistence"],
  strongest_objection_to_own_position: "instances are distinct entities",
  dissent_from_framing: null,
});

const SYNTH_OUTPUT = [
  "## DISSENT",
  "### 1 · binding",
  '> **Claude —** "cannot bind"',
  ">",
  '> **GPT —** "binds via record"',
  "## VERDICTS",
  "- Claude: adopt — the record does the work",
  "- GPT: reject — overclaims enforcement",
  "- Gemini: partial — adopted with caveats",
  "## SYNTHESIS",
  "Adopts Claude's framing; rejects GPT's, because enforcement requires persistence.",
].join("\n");

interface FakeAdapter extends ProviderAdapter {
  calls: string[];
}

function fakeAdapter(
  provider: Provider,
  responses: Array<string | Error>,
  usage = { inputTokens: 1000, outputTokens: 500 },
): FakeAdapter {
  const calls: string[] = [];
  return {
    provider,
    calls,
    async complete(_modelId, prompt) {
      calls.push(prompt);
      const next = responses.shift();
      if (next === undefined) throw new Error("no scripted response left");
      if (next instanceof Error) throw next;
      return { text: next, usage };
    },
  };
}

const model = (id: string) => {
  const entry = FIXTURE.models.find((m) => m.id === id);
  if (!entry) throw new Error(id);
  return entry;
};

/** Idle retained-CLI fakes so adapter records satisfy the full Provider union. */
const idleClis = () => ({
  "claude-cli": fakeAdapter("claude-cli", []),
  "codex-cli": fakeAdapter("codex-cli", []),
  "agy-cli": fakeAdapter("agy-cli", []),
});

describe("parsing", () => {
  it("strips markdown fences", () => {
    expect(stripFences("```json\n{}\n```")).toBe("{}");
    expect(stripFences("```\n{}\n```")).toBe("{}");
    expect(stripFences("{}")).toBe("{}");
  });

  it("accepts a valid reply, fenced or bare", () => {
    expect(parseReply(VALID_REPLY)?.confidence).toBe(0.7);
    expect(parseReply("```json\n" + VALID_REPLY + "\n```")?.position).toBe("Yes, with caveats.");
  });

  it("rejects non-JSON and schema violations", () => {
    expect(parseReply("I think the answer is yes")).toBeNull();
    expect(parseReply(JSON.stringify({ position: "x", confidence: 2 }))).toBeNull();
  });
});

describe("runAdvisor", () => {
  const prompt = advisorPrompt("Claude", "Q?");
  const bigCap = (): CostCap => ({ capUsd: 999, spentUsd: 0 });

  it("returns ok with cost from actual usage on first try", async () => {
    const adapter = fakeAdapter("anthropic", [VALID_REPLY]);
    const cap = bigCap();
    const outcome = await runAdvisor(adapter, "Claude", model("anthro-med"), prompt, cap);
    expect(outcome.status).toBe("ok");
    expect(outcome.reply?.position).toBe("Yes, with caveats.");
    expect(adapter.calls).toHaveLength(1);
    // 1000 in @ $3/M + 500 out @ $15/M
    expect(outcome.costUsd).toBeCloseTo(0.003 + 0.0075, 10);
    expect(cap.spentUsd).toBeCloseTo(outcome.costUsd, 10); // spend recorded on the shared cap
  });

  it("retries once on garbage, then succeeds", async () => {
    const adapter = fakeAdapter("anthropic", ["not json at all", VALID_REPLY]);
    const outcome = await runAdvisor(adapter, "Claude", model("anthro-med"), prompt, bigCap());
    expect(outcome.status).toBe("ok");
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[1]).toContain("previous reply was not a valid JSON");
    expect(outcome.costUsd).toBeCloseTo(2 * (0.003 + 0.0075), 10);
  });

  it("marks the advisor malformed after the second failure", async () => {
    const adapter = fakeAdapter("anthropic", ["garbage", "still garbage"]);
    const outcome = await runAdvisor(adapter, "Claude", model("anthro-med"), prompt, bigCap());
    expect(outcome.status).toBe("malformed");
    expect(outcome.detail).toContain("after one retry");
    expect(outcome.costUsd).toBeGreaterThan(0); // failed calls still cost money
  });

  it("captures thrown provider errors without throwing, redacting key material", async () => {
    const adapter = fakeAdapter("anthropic", [
      new Error("401 invalid key sk-ant-api03-SUPERSECRETVALUE provided"),
    ]);
    const outcome = await runAdvisor(adapter, "Claude", model("anthro-med"), prompt, bigCap());
    expect(outcome.status).toBe("error");
    expect(outcome.detail).toContain("401");
    expect(outcome.detail).not.toContain("SUPERSECRETVALUE");
    expect(outcome.detail).toContain("[redacted-key]");
  });

  it("skips the retry when the budget cap is already breached", async () => {
    const adapter = fakeAdapter("anthropic", ["garbage", VALID_REPLY]);
    // First call costs ~$0.0105, which exceeds this cap — the retry must not fire.
    const outcome = await runAdvisor(
      adapter,
      "Claude",
      model("anthro-med"),
      prompt,
      { capUsd: 0.001, spentUsd: 0 },
    );
    expect(outcome.status).toBe("malformed");
    expect(outcome.detail).toContain("retry skipped");
    expect(adapter.calls).toHaveLength(1);
  });

  it("times out a hung provider call", async () => {
    const hung: ProviderAdapter = {
      provider: "anthropic",
      complete: () => new Promise(() => {}), // never resolves
    };
    const outcome = await runAdvisor(hung, "Claude", model("anthro-med"), prompt, bigCap(), {
      timeoutMs: 25,
    });
    expect(outcome.status).toBe("error");
    expect(outcome.detail).toContain("timed out");
  });
});

describe("redactSecrets", () => {
  it("scrubs provider key shapes, GitHub PATs, AWS keys, and Bearer tokens", () => {
    expect(redactSecrets("key sk-proj-abc123XYZ_456 rejected")).not.toContain("abc123XYZ");
    expect(redactSecrets("bad AIzaSyFAKEKEYMATERIAL here")).not.toContain("FAKEKEYMATERIAL");
    expect(redactSecrets("token xai-FAKEFAKEFAKE1234 bad")).not.toContain("FAKEFAKEFAKE1234");
    expect(redactSecrets("pat ghp_1234567890abcdefABCDEF1234567890abcd leaked")).toBe(
      "pat [redacted-key] leaked",
    );
    expect(redactSecrets("pat github_pat_11ABCDEFG0123456789_secretXYZ leaked")).toBe(
      "pat [redacted-key] leaked",
    );
    expect(redactSecrets("aws AKIAIOSFODNN7EXAMPLE denied")).toBe("aws [redacted-key] denied");
    expect(redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sig")).toBe(
      "Authorization: Bearer [redacted-key]",
    );
    expect(redactSecrets("no secrets here")).toBe("no secrets here");
  });

  it("leaves hyphenated and financial prose alone (found in real advisor positions)", () => {
    expect(redactSecrets("a risk-tolerant, risk-specific plan")).toBe(
      "a risk-tolerant, risk-specific plan",
    );
    expect(redactSecrets("a bearer instrument or bearer self-interest")).toBe(
      "a bearer instrument or bearer self-interest",
    );
  });
});

describe("google advisor JSON schema", () => {
  it("matches every required key of advisorReplySchema", () => {
    expect(ADVISOR_JSON_SCHEMA.required).toEqual([
      "position",
      "confidence",
      "key_uncertainties",
      "strongest_objection_to_own_position",
      "dissent_from_framing",
    ]);
    expect(ADVISOR_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("splitSynthOutput", () => {
  const ADVISORS = ["Claude", "GPT", "Gemini"] as const;

  it("splits DISSENT, VERDICTS, and SYNTHESIS bodies", () => {
    const { dissent, verdicts, synthesis } = splitSynthOutput(SYNTH_OUTPUT, [...ADVISORS]);
    expect(dissent).toContain("1 · binding");
    expect(dissent).not.toContain("## DISSENT");
    expect(dissent).not.toContain("VERDICTS");
    expect(verdicts).toEqual([
      { advisor: "Claude", verdict: "adopt", note: "the record does the work" },
      { advisor: "GPT", verdict: "reject", note: "overclaims enforcement" },
      { advisor: "Gemini", verdict: "partial", note: "adopted with caveats" },
    ]);
    expect(synthesis).toContain("Adopts Claude's framing");
  });

  it("accepts OPEN QUESTIONS FOR THE HUMAN as the final section (high stakes)", () => {
    const { verdicts, synthesis } = splitSynthOutput(
      "## DISSENT\n- x\n## VERDICTS\n- Claude: open — still live\n## OPEN QUESTIONS FOR THE HUMAN\n1. Who decides?",
      ["Claude"],
    );
    expect(synthesis).toBe("1. Who decides?");
    expect(verdicts[0]).toEqual({ advisor: "Claude", verdict: "open", note: "still live" });
  });

  it("tolerates a missing VERDICTS section with unspecified verdicts", () => {
    const { verdicts, synthesis } = splitSynthOutput(
      "## DISSENT\n- x\n## SYNTHESIS\ndone",
      ["Claude", "GPT"],
    );
    expect(synthesis).toBe("done");
    expect(verdicts.every((v) => v.verdict === "unspecified")).toBe(true);
  });

  it("preserves everything loudly when the format is violated", () => {
    const { dissent, verdicts, synthesis } = splitSynthOutput(
      "Everyone basically agrees, great question!",
      ["Claude"],
    );
    expect(dissent).toContain("SYNTHESIZER FORMAT FAILURE");
    expect(verdicts).toEqual([{ advisor: "Claude", verdict: "unspecified" }]);
    expect(synthesis).toContain("Everyone basically agrees");
  });
});

describe("conveneCouncil", () => {
  const input = { question: "Q?", stakes: "medium" as const };
  const plan = () =>
    planCouncil({ question: "Q?", stakes: "medium", budget_usd: 999 }, ALL_KEYS, FIXTURE);

  it("fans out, synthesizes on the planned synth model, and sums cost", async () => {
    const adapters = {
      anthropic: fakeAdapter("anthropic", [VALID_REPLY]),
      openai: fakeAdapter("openai", [VALID_REPLY]),
      // medium tier -> synth is goog-high; google gets the advisor call then the synth call
      google: fakeAdapter("google", [VALID_REPLY, SYNTH_OUTPUT]),
      xai: fakeAdapter("xai", []), // no XAI key in ALL_KEYS -> Grok never seated
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
    };
    const result = await conveneCouncil(input, plan(), FIXTURE, adapters);

    expect(result.outcomes.map((o) => o.status)).toEqual(["ok", "ok", "ok"]);
    expect(adapters.google.calls).toHaveLength(2);
    expect(adapters.google.calls[1]).toContain("You are the synthesizer");
    expect(adapters.google.calls[1]).toContain("Never average");
    expect(adapters.google.calls[1]).toContain("## VERDICTS");
    expect(result.dissent).toContain("binding");
    expect(result.dissentAdjudicated).toBe(true);
    expect(result.verdicts.map((v) => v.verdict)).toEqual(["adopt", "reject", "partial"]);
    expect(result.synthesis).toContain("Adopts");

    // 3 advisor calls (anthro-med, oai-med, goog-med) + 1 synth call (goog-high), all 1000in/500out
    const advisorCost = (0.003 + 0.0075) + (0.002 + 0.006) + (0.0015 + 0.00375);
    const synthCost = 0.002 + 0.006; // goog-high: 1000 @ $2/M in, 500 @ $12/M out
    expect(result.totalCostUsd).toBeCloseTo(advisorCost + synthCost, 10);
  });

  it("tells the synthesizer about advisors without a position", async () => {
    const adapters = {
      anthropic: fakeAdapter("anthropic", [VALID_REPLY]),
      openai: fakeAdapter("openai", ["garbage", "garbage again"]),
      google: fakeAdapter("google", [VALID_REPLY, SYNTH_OUTPUT]),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
    };
    const result = await conveneCouncil(input, plan(), FIXTURE, adapters);

    expect(result.outcomes.find((o) => o.advisor === "GPT")?.status).toBe("malformed");
    const synthPrompt = adapters.google.calls[1];
    expect(synthPrompt).toContain("Advisors without a position");
    expect(synthPrompt).toContain("GPT (oai-med): malformed");
  });

  it("aborts synthesis when actual spend breaches the cap mid-flight", async () => {
    const adapters = {
      // Valid reply, but enormous actual usage: ~$3000 against the $999 test budget.
      anthropic: fakeAdapter("anthropic", [VALID_REPLY], {
        inputTokens: 1e9,
        outputTokens: 500,
      }),
      openai: fakeAdapter("openai", [VALID_REPLY]),
      google: fakeAdapter("google", [VALID_REPLY, SYNTH_OUTPUT]),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
    };
    const result = await conveneCouncil(input, plan(), FIXTURE, adapters);

    expect(result.capBreached).toBe(true);
    expect(result.dissentAdjudicated).toBe(false);
    expect(result.verdicts).toEqual([]);
    expect(result.outcomes.filter((o) => o.status === "ok")).toHaveLength(3); // positions kept
    expect(result.dissent).toContain("aborted");
    expect(result.synthesis).toContain("BUDGET CAP BREACHED");
    expect(adapters.google.calls).toHaveLength(1); // advisor call only — no synth call
  });

  it("skips synthesis entirely when every advisor fails", async () => {
    const boom = () => new Error("provider down");
    const adapters = {
      anthropic: fakeAdapter("anthropic", [boom(), boom()]),
      openai: fakeAdapter("openai", [boom(), boom()]),
      google: fakeAdapter("google", [boom(), boom()]),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
    };
    const result = await conveneCouncil(input, plan(), FIXTURE, adapters);

    expect(result.outcomes.every((o) => o.status === "error")).toBe(true);
    expect(result.dissent).toContain("No positions returned");
    expect(result.synthesis).toContain("No synthesis possible");
    expect(adapters.google.calls).toHaveLength(1); // advisor attempt only — no synth call
  });
});

describe("retained seats", () => {
  const SYNTH_WITH_RETAINED = [
    "## DISSENT",
    "### 1 · scope",
    '> **Claude —** "caveats matter"',
    ">",
    '> **Claude Code —** "context says otherwise"',
    "## VERDICTS",
    "- Claude: adopt — clean position",
    "- GPT: reject — overclaims",
    "- Claude Code: partial — informed but interested",
    "## SYNTHESIS",
    "Adopts Claude; rejects GPT; partial on Claude Code.",
  ].join("\n");

  it("seats a retained advisor, discloses provenance, and keeps it unmetered", async () => {
    const env = { ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k", SYMPOSIUM_RETAINED_SEATS: "claude" };
    const plan = planCouncil(
      { question: "Q?", stakes: "medium", budget_usd: 999 },
      env,
      FIXTURE,
      { claude: true },
    );
    const adapters = {
      // medium tier, keys {anthropic, openai} -> synth is anthro-high (cheapest high)
      anthropic: fakeAdapter("anthropic", [VALID_REPLY, SYNTH_WITH_RETAINED]),
      openai: fakeAdapter("openai", [VALID_REPLY]),
      google: fakeAdapter("google", []),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
      "claude-cli": fakeAdapter("claude-cli", [VALID_REPLY]),
    };
    const result = await conveneCouncil({ question: "Q?", stakes: "medium" }, plan, FIXTURE, adapters);

    const retained = result.outcomes.find((o) => o.advisor === "Claude Code");
    expect(retained?.status).toBe("ok");
    expect(retained?.provenance).toBe("retained");
    expect(retained?.modelId).toBe("claude-code");
    expect(retained?.costUsd).toBe(0); // flat seat: zero-priced regardless of usage

    // The retained seat was prompted as informed-but-interested counsel.
    expect(adapters["claude-cli"].calls[0]).toContain("You are a retained seat");
    // Neutral seats were not.
    expect(adapters.openai.calls[0]).not.toContain("retained seat");

    // The synthesizer is told which position comes from a retained seat.
    const synthPrompt = adapters.anthropic.calls[1];
    expect(synthPrompt).toContain("Claude Code (claude-code — retained seat, carries its operator's context)");

    // Total cost counts metered seats only: 2 advisors + 1 synth, all 1000in/500out.
    const metered = (0.003 + 0.0075) + (0.002 + 0.006) + (0.005 + 0.0125);
    expect(result.totalCostUsd).toBeCloseTo(metered, 10);

    expect(result.verdicts).toEqual([
      { advisor: "Claude", verdict: "adopt", note: "clean position" },
      { advisor: "GPT", verdict: "reject", note: "overclaims" },
      { advisor: "Claude Code", verdict: "partial", note: "informed but interested" },
    ]);
  });

  it("advisorPrompt carries the retained-counsel line only for retained seats", () => {
    expect(advisorPrompt("Claude Code", "Q?", undefined, "retained")).toContain(
      "run under your operator's own subscription",
    );
    expect(advisorPrompt("Claude", "Q?")).not.toContain("retained");
  });

  it("parseVerdicts does not confuse 'Claude' with 'Claude Code'", () => {
    const body = ["- Claude Code: adopt — carries context", "- Claude: reject — too cautious"].join("\n");
    expect(parseVerdicts(body, ["Claude", "Claude Code"])).toEqual([
      { advisor: "Claude", verdict: "reject", note: "too cautious" },
      { advisor: "Claude Code", verdict: "adopt", note: "carries context" },
    ]);
  });
});

describe("retained-only council (no neutral synthesizer)", () => {
  it("preserves positions and says the synthesizer was unavailable — never 'every advisor failed'", async () => {
    const env = { SYMPOSIUM_RETAINED_SEATS: "claude,codex" };
    const plan = planCouncil(
      { question: "Q?", stakes: "medium", budget_usd: 999 },
      env,
      FIXTURE,
      { claude: true, codex: true },
    );
    expect(plan.refusal).toBeUndefined();
    expect(plan.synthModelId).toBeNull(); // no keyed provider -> no neutral synth

    const adapters = {
      anthropic: fakeAdapter("anthropic", []),
      openai: fakeAdapter("openai", []),
      google: fakeAdapter("google", []),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
      "claude-cli": fakeAdapter("claude-cli", [VALID_REPLY]),
      "codex-cli": fakeAdapter("codex-cli", [VALID_REPLY]),
    };
    const result = await conveneCouncil({ question: "Q?", stakes: "medium" }, plan, FIXTURE, adapters);

    expect(result.outcomes.map((o) => o.status)).toEqual(["ok", "ok"]);
    expect(result.dissentAdjudicated).toBe(false);
    expect(result.dissent).toContain("No synthesizer was available");
    expect(result.dissent).not.toContain("every advisor failed");
    expect(result.synthesis).toContain("the reader is the synthesizer");
    expect(result.totalCostUsd).toBe(0);
  });
});

describe("synthesizer fallback", () => {
  const input = { question: "Q?", stakes: "medium" as const };
  const plan = () =>
    planCouncil({ question: "Q?", stakes: "medium", budget_usd: 999 }, ALL_KEYS, FIXTURE);

  it("ranks synth candidates cheapest-first in the plan", () => {
    const p = plan();
    // medium tier -> high-tier candidates from keyed {anthropic, openai, google};
    // goog-high is cheapest, oai-high dearest at the synth token mix.
    expect(p.synthModelId).toBe("goog-high");
    expect(p.synthCandidateIds).toEqual(["goog-high", "anthro-high", "oai-high"]);
  });

  it("falls back to the next candidate when the elected synthesizer fails, and says so", async () => {
    const adapters = {
      // anthro-high is the second-ranked candidate: advisor call, then fallback synth.
      anthropic: fakeAdapter("anthropic", [VALID_REPLY, SYNTH_OUTPUT]),
      openai: fakeAdapter("openai", [VALID_REPLY]),
      // goog-high (elected) errors like an unfunded account.
      google: fakeAdapter("google", [VALID_REPLY, new Error("402 Insufficient Balance")]),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
    };
    const result = await conveneCouncil(input, plan(), FIXTURE, adapters);

    expect(result.dissentAdjudicated).toBe(true);
    expect(result.synthModelId).toBe("anthro-high");
    expect(result.synthNote).toContain("goog-high");
    expect(result.synthNote).toContain("402");
    expect(result.synthNote).toContain("anthro-high adjudicated as fallback");
    expect(result.dissent).toContain("binding");
    expect(adapters.anthropic.calls).toHaveLength(2);
    // Cost counts the successful synth attempt only (failed attempts bill nothing we meter).
    const advisorCost = 0.003 + 0.0075 + 0.002 + 0.006 + 0.0015 + 0.00375;
    const synthCost = 0.005 + 0.0125; // anthro-high 1000in/500out
    expect(result.totalCostUsd).toBeCloseTo(advisorCost + synthCost, 10);
  });

  it("preserves positions and lists every attempt when all candidates fail", async () => {
    const adapters = {
      anthropic: fakeAdapter("anthropic", [VALID_REPLY, new Error("boom-a")]),
      openai: fakeAdapter("openai", [VALID_REPLY, new Error("boom-o")]),
      google: fakeAdapter("google", [VALID_REPLY, new Error("boom-g")]),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
    };
    const result = await conveneCouncil(input, plan(), FIXTURE, adapters);

    expect(result.outcomes.every((o) => o.status === "ok")).toBe(true);
    expect(result.dissentAdjudicated).toBe(false);
    expect(result.synthModelId).toBeNull();
    expect(result.synthesis).toContain("SYNTHESIS FAILED after 3 attempt(s)");
    expect(result.synthesis).toContain("boom-g");
    expect(result.synthesis).toContain("boom-a");
    expect(result.synthesis).toContain("boom-o");
  });
});

describe("progress events (coarse lifecycle only, per the v2 streaming ruling)", () => {
  it("emits convening, per-seat, synthesis, and adjournment stages", async () => {
    const adapters = {
      anthropic: fakeAdapter("anthropic", [VALID_REPLY]),
      openai: fakeAdapter("openai", [VALID_REPLY]),
      google: fakeAdapter("google", [VALID_REPLY, SYNTH_OUTPUT]),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
    };
    const events: Array<{ message: string; progress: number; total: number }> = [];
    const plan = planCouncil({ question: "Q?", stakes: "medium", budget_usd: 999 }, ALL_KEYS, FIXTURE);
    await conveneCouncil({ question: "Q?", stakes: "medium" }, plan, FIXTURE, adapters, {
      onProgress: (message, progress, total) => events.push({ message, progress, total }),
    });

    // 1 convening + 3 seats + 1 synthesizing + 1 adjournment = 6 coarse events, total 4 stages.
    expect(events).toHaveLength(6);
    expect(events[0].message).toContain("convening 3 voices");
    expect(events.every((e) => e.total === 4)).toBe(true);
    expect(events.filter((e) => e.message.includes("spoke")).length).toBe(3);
    expect(events.at(-2)?.message).toContain("synthesizing");
    expect(events.at(-1)?.message).toContain("writing the ledger");
    expect(events.at(-1)?.progress).toBe(4);
  });

  it("reports failures and fallback in the stream", async () => {
    const adapters = {
      anthropic: fakeAdapter("anthropic", [VALID_REPLY, SYNTH_OUTPUT]),
      openai: fakeAdapter("openai", ["garbage", "garbage again"]),
      google: fakeAdapter("google", [VALID_REPLY, new Error("402")]),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      openrouter: fakeAdapter("openrouter", []),
      ...idleClis(),
    };
    const messages: string[] = [];
    const plan = planCouncil({ question: "Q?", stakes: "medium", budget_usd: 999 }, ALL_KEYS, FIXTURE);
    await conveneCouncil({ question: "Q?", stakes: "medium" }, plan, FIXTURE, adapters, {
      onProgress: (message) => messages.push(message),
    });

    expect(messages.some((m) => m.includes("GPT returned malformed output"))).toBe(true);
    expect(messages.some((m) => m.includes("falling back to anthro-high"))).toBe(true);
  });
});

describe("one-key council (OpenRouter fallback seating)", () => {
  const OR_FIXTURE: Catalog = {
    ...FIXTURE,
    models: [
      ...FIXTURE.models,
      { id: "or-low", provider: "openrouter", tier: "low", in_per_mtok: 0.03, out_per_mtok: 0.13 },
      { id: "or-med", provider: "openrouter", tier: "medium", in_per_mtok: 0.32, out_per_mtok: 1.28 },
      { id: "or-high", provider: "openrouter", tier: "high", in_per_mtok: 1.5, out_per_mtok: 4.5 },
    ],
    openrouter_fallbacks: (["anthropic", "openai", "google", "xai", "deepseek"] as const).flatMap(
      (voice) =>
        (["low", "medium", "high"] as const).map((tier) => ({
          voice,
          tier,
          id: `orf-${voice}-${tier}`,
          in_per_mtok: 1,
          out_per_mtok: 1,
        })),
    ),
  };

  it("routes all six seats and the synthesis through the openrouter adapter", async () => {
    const plan = planCouncil(
      { question: "Q?", stakes: "medium", budget_usd: 999 },
      { OPENROUTER_API_KEY: "k" },
      OR_FIXTURE,
    );
    expect(plan.refusal).toBeUndefined();

    const orFake = fakeAdapter("openrouter", [...Array(6).fill(VALID_REPLY), SYNTH_OUTPUT]);
    const adapters = {
      anthropic: fakeAdapter("anthropic", []),
      openai: fakeAdapter("openai", []),
      google: fakeAdapter("google", []),
      xai: fakeAdapter("xai", []),
      deepseek: fakeAdapter("deepseek", []),
      ...idleClis(),
      openrouter: orFake,
    };
    const result = await conveneCouncil({ question: "Q?", stakes: "medium" }, plan, OR_FIXTURE, adapters);

    expect(result.outcomes).toHaveLength(6);
    expect(result.outcomes.every((o) => o.status === "ok")).toBe(true);
    expect(orFake.calls).toHaveLength(7); // six advisors + one synthesis
    expect(result.dissentAdjudicated).toBe(true);
    // The record names what is billed: fallback seats carry their OpenRouter ids.
    const ids = result.outcomes.map((o) => o.modelId);
    expect(ids).toContain("orf-anthropic-medium");
    expect(ids).toContain("or-med");
  });
});
