import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { conveneCouncil, type AdvisorOutcome } from "./council.js";
import { writeLedger, type AdvisorPosition, type Stakes } from "./ledger.js";
import { loadCatalog, planCouncil, type CouncilPlan } from "./router.js";

const catalog = loadCatalog(); // fail fast on a malformed models.json

function estimateBlock(plan: CouncilPlan): string {
  const advisors = plan.advisors
    .map((a) => `${a.name} → ${a.available ? a.modelId : "(skipped)"}`)
    .join(", ");
  const notices = plan.advisors.filter((a) => a.notice).map((a) => `${a.name} ${a.notice}`);
  const lines = [
    `1. Cost estimate: $${plan.estimateUsd.toFixed(4)} | budget: $${plan.budgetUsd.toFixed(4)} | ` +
      `tier: ${plan.tier}${plan.downgraded ? ` (downgraded from ${plan.requestedTier} to fit budget)` : ""}`,
    `   Advisors: ${advisors} | synth: ${plan.synthModelId ?? "none"}`,
  ];
  if (notices.length > 0) lines.push(`   Notices: ${notices.join("; ")}`);
  return lines.join("\n");
}

function positionOf(outcome: AdvisorOutcome): AdvisorPosition {
  if (outcome.status === "ok" && outcome.reply) {
    const framing = outcome.reply.dissent_from_framing;
    return {
      advisor: outcome.advisor,
      modelId: outcome.modelId,
      confidence: outcome.reply.confidence,
      position:
        outcome.reply.position + (framing ? `\n\n*Dissent from framing:* ${framing}` : ""),
      uncertainties: outcome.reply.key_uncertainties,
      selfObjection: outcome.reply.strongest_objection_to_own_position,
    };
  }
  return {
    advisor: outcome.advisor,
    modelId: outcome.modelId,
    confidence: 0,
    position: `${outcome.status.toUpperCase()}: ${outcome.detail ?? "no detail"}`,
    uncertainties: [],
    selfObjection: "n/a",
  };
}

const server = new McpServer({ name: "symposium", version: "0.4.0" });

server.registerTool(
  "convene_council",
  {
    title: "Convene the council",
    description:
      "Convene a council of AI advisors (Claude, GPT, Gemini, Grok) on one question. " +
      "Fans out to live advisors in parallel, surfaces disagreement verbatim in a DISSENT " +
      "section, synthesizes (or, for high/audited stakes, stops with open questions for the " +
      "human), and writes the full deliberation to a Markdown ledger. Cost is estimated " +
      "pre-flight and enforced against a budget; set dry_run to preview the estimate " +
      "without calling any provider or writing a ledger.",
    inputSchema: {
      question: z.string().min(1, "question must be non-empty"),
      context: z.string().optional(),
      stakes: z.enum(["low", "medium", "high", "audited"]),
      budget_usd: z.number().positive().optional(),
      dry_run: z.boolean().optional(),
    },
  },
  async ({ question, context, stakes, budget_usd, dry_run }) => {
    const started = Date.now();
    const highStakes = stakes === "high" || stakes === "audited";

    const plan = planCouncil(
      { question, context, stakes: stakes as Stakes, budget_usd },
      process.env,
      catalog,
    );

    if (plan.refusal) {
      const text = [
        `REFUSED — ${plan.refusal}`,
        ``,
        estimateBlock(plan),
        ``,
        `No ledger written (nothing was deliberated).`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }

    if (dry_run) {
      const text = [
        estimateBlock(plan),
        ``,
        `Dry run — no provider called, no ledger written.`,
      ].join("\n");
      return { content: [{ type: "text", text }] };
    }

    const result = await conveneCouncil(
      { question, context, stakes: stakes as Stakes },
      plan,
      catalog,
    );

    const skippedSeats: AdvisorPosition[] = plan.advisors
      .filter((a) => !a.available)
      .map((a) => ({
        advisor: a.name,
        modelId: "skipped",
        confidence: 0,
        position: `Skipped: ${a.notice}`,
        uncertainties: [],
        selfObjection: "n/a",
      }));
    const positions = [...result.outcomes.map(positionOf), ...skippedSeats];
    const latencyMs = Date.now() - started;

    const ledgerPath = writeLedger({
      date: new Date(started),
      question,
      context,
      stakes: stakes as Stakes,
      advisorModelIds: result.outcomes.map((o) => o.modelId),
      synthModelId: plan.synthModelId ?? "none",
      costUsd: result.totalCostUsd,
      latencyMs,
      positions,
      dissent: result.dissent,
      synthesis: result.synthesis,
      relations: [],
    });

    const text = [
      estimateBlock(plan),
      ``,
      `2. Positions:`,
      ...positions.map(
        (p) =>
          `   - ${p.advisor} (${p.modelId}, confidence ${p.confidence.toFixed(2)}): ` +
          p.position.replace(/\n+/g, " "),
      ),
      ``,
      `3. DISSENT:`,
      ...result.dissent.split("\n").map((line) => `   ${line}`),
      ``,
      `4. ${highStakes ? "Open questions for the human" : "Synthesis"}:`,
      ...result.synthesis.split("\n").map((line) => `   ${line}`),
      ``,
      `5. Actual cost: $${result.totalCostUsd.toFixed(4)} (estimate was $${plan.estimateUsd.toFixed(4)}) | ` +
        `latency: ${latencyMs}ms | ledger: ${ledgerPath}`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("symposium MCP server ready (stdio)");
