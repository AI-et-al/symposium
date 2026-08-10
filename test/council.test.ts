import { describe, expect, it } from "vitest";
import {
  advisorPrompt,
  conveneCouncil,
  parseReply,
  redactSecrets,
  runAdvisor,
  splitSynthOutput,
  stripFences,
  type CostCap,
} from "../src/council.js";
import type { ProviderAdapter } from "../src/providers/types.js";
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
  it("scrubs provider key shapes", () => {
    expect(redactSecrets("key sk-proj-abc123XYZ_456 rejected")).not.toContain("abc123XYZ");
    expect(redactSecrets("bad AIzaSyFAKEKEYMATERIAL here")).not.toContain("FAKEKEYMATERIAL");
    expect(redactSecrets("token xai-FAKEFAKEFAKE1234 bad")).not.toContain("FAKEFAKEFAKE1234");
    expect(redactSecrets("no secrets here")).toBe("no secrets here");
  });

  it("leaves hyphenated prose alone (found in a real advisor position)", () => {
    expect(redactSecrets("a risk-tolerant, risk-specific plan")).toBe(
      "a risk-tolerant, risk-specific plan",
    );
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
    };
    const result = await conveneCouncil(input, plan(), FIXTURE, adapters);

    expect(result.outcomes.every((o) => o.status === "error")).toBe(true);
    expect(result.dissent).toContain("No positions returned");
    expect(result.synthesis).toContain("No synthesis possible");
    expect(adapters.google.calls).toHaveLength(1); // advisor attempt only — no synth call
  });
});
