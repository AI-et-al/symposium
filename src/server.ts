import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeLedger, type AdvisorPosition, type Stakes } from "./ledger.js";

const STUB_NOTICE =
  "Phase 1 stub — no provider was called. Router arrives in Phase 2, live advisors in Phase 3.";

const stubPositions: AdvisorPosition[] = [
  { advisor: "Claude", modelId: "stub", confidence: 0, position: STUB_NOTICE, uncertainties: [], selfObjection: "n/a (stub)" },
  { advisor: "GPT", modelId: "stub", confidence: 0, position: STUB_NOTICE, uncertainties: [], selfObjection: "n/a (stub)" },
  { advisor: "Gemini", modelId: "stub", confidence: 0, position: STUB_NOTICE, uncertainties: [], selfObjection: "n/a (stub)" },
];

const server = new McpServer({ name: "symposium", version: "0.1.0" });

server.registerTool(
  "convene_council",
  {
    title: "Convene the council",
    description:
      "Convene a council of AI advisors (Claude, GPT, Gemini) on one question. " +
      "Surfaces disagreement verbatim, writes the deliberation to a Markdown ledger. " +
      "Phase 1: returns a hardcoded stub and writes a stub ledger file.",
    inputSchema: {
      question: z.string().min(1, "question must be non-empty"),
      context: z.string().optional(),
      stakes: z.enum(["low", "medium", "high", "audited"]),
      budget_usd: z.number().positive().optional(),
    },
  },
  async ({ question, context, stakes }) => {
    const started = Date.now();
    const highStakes = stakes === "high" || stakes === "audited";

    const dissent = `- **stub** — ${STUB_NOTICE}`;
    const synthesis = highStakes
      ? `Open questions for the human: none yet — ${STUB_NOTICE}`
      : `No synthesis — ${STUB_NOTICE}`;

    const ledgerPath = writeLedger({
      date: new Date(started),
      question,
      context,
      stakes: stakes as Stakes,
      advisorModelIds: ["stub", "stub", "stub"],
      synthModelId: "stub",
      costUsd: 0,
      latencyMs: Date.now() - started,
      positions: stubPositions,
      dissent,
      synthesis,
      relations: [],
    });

    const text = [
      `1. Cost estimate: $0.0000 (stub — router arrives in Phase 2)`,
      ``,
      `2. Positions:`,
      ...stubPositions.map((p) => `   - ${p.advisor} (${p.modelId}): ${p.position}`),
      ``,
      `3. DISSENT:`,
      `   ${dissent}`,
      ``,
      `4. ${highStakes ? "Open questions for the human" : "Synthesis"}: ${synthesis}`,
      ``,
      `5. Actual cost: $0.0000 | latency: ${Date.now() - started}ms | ledger: ${ledgerPath}`,
    ].join("\n");

    return { content: [{ type: "text", text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("symposium MCP server ready (stdio)");
