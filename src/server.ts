import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeLedger, type AdvisorPosition, type Stakes } from "./ledger.js";
import { loadCatalog, planCouncil, type CouncilPlan } from "./router.js";

const STUB_NOTICE =
  "Stub — no provider was called. Live advisors arrive in Phase 3.";

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

const server = new McpServer({ name: "symposium", version: "0.2.0" });

server.registerTool(
  "convene_council",
  {
    title: "Convene the council",
    description:
      "Convene a council of AI advisors (Claude, GPT, Gemini) on one question. " +
      "Surfaces disagreement verbatim, writes the deliberation to a Markdown ledger. " +
      "Phase 2: real cost pre-flight and budget enforcement (downgrade/refuse); " +
      "set dry_run to preview the estimate without writing a ledger. " +
      "Positions are stubs until live advisors arrive in Phase 3.",
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

    const positions: AdvisorPosition[] = plan.advisors.map((a) => ({
      advisor: a.name,
      modelId: a.available ? (a.modelId ?? "unresolved") : "skipped",
      confidence: 0,
      position: a.available ? STUB_NOTICE : `Skipped: ${a.notice}`,
      uncertainties: [],
      selfObjection: "n/a (stub)",
    }));

    const dissent = `- **stub** — ${STUB_NOTICE}`;
    const synthesis = highStakes
      ? `Open questions for the human: none yet — ${STUB_NOTICE}`
      : `No synthesis — ${STUB_NOTICE}`;

    const ledgerPath = writeLedger({
      date: new Date(started),
      question,
      context,
      stakes: stakes as Stakes,
      advisorModelIds: plan.advisors.filter((a) => a.available).map((a) => a.modelId ?? "unresolved"),
      synthModelId: plan.synthModelId ?? "none",
      costUsd: 0,
      latencyMs: Date.now() - started,
      positions,
      dissent,
      synthesis,
      relations: [],
    });

    const text = [
      estimateBlock(plan),
      ``,
      `2. Positions:`,
      ...positions.map((p) => `   - ${p.advisor} (${p.modelId}): ${p.position}`),
      ``,
      `3. DISSENT:`,
      `   ${dissent}`,
      ``,
      `4. ${highStakes ? "Open questions for the human" : "Synthesis"}: ${synthesis}`,
      ``,
      `5. Actual cost: $0.0000 (stub — no provider called) | latency: ${Date.now() - started}ms | ledger: ${ledgerPath}`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("symposium MCP server ready (stdio)");
