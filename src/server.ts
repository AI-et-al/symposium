import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  conveneCouncil,
  type AdvisorOutcome,
  type AdvisorVerdict,
  type CouncilResult,
} from "./council.js";
import { writeLedger, type AdvisorPosition, type Stakes } from "./ledger.js";
import { loadCatalog, planCouncil, type AdvisorName, type CouncilPlan } from "./router.js";

const catalog = loadCatalog(); // fail fast on a malformed models.json

// ── The chamber theme (docs/council-theme.md) ────────────────────────────────
// Color carriers that survive MCP tool-result rendering: emoji chips + diff fences.
// SYMPOSIUM_MONOCHROME=1 degrades to the glyph ladder with no loss of meaning.

const MONO = process.env.SYMPOSIUM_MONOCHROME === "1";

const SEAT: Record<AdvisorName, { chip: string; fill: string }> = {
  Claude: { chip: "🟠", fill: "🟧" },
  GPT: { chip: "🟢", fill: "🟩" },
  Gemini: { chip: "🔵", fill: "🟦" },
  Grok: { chip: "⚫", fill: "⬛" },
  DeepSeek: { chip: "🟣", fill: "🟪" },
};

const chip = (name: AdvisorName) => (MONO ? "●" : SEAT[name].chip);

function bar(name: AdvisorName, confidence: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(confidence * 10)));
  return MONO
    ? "▓".repeat(filled) + "░".repeat(10 - filled)
    : SEAT[name].fill.repeat(filled) + "⬜".repeat(10 - filled);
}

const EMPTY_BAR = (MONO ? "░".repeat(10) : "⬜".repeat(10)) + " ✗";
const BAND = "▓".repeat(48);
const DEGRADED_BAND = "▒".repeat(48);
const BROKEN_BAND = "█".repeat(48);

function budgetMeter(spentUsd: number, capUsd: number, breached: boolean): string {
  if (breached) return (MONO ? "█".repeat(10) : "🟥".repeat(10)) + ` ${Math.round((spentUsd / capUsd) * 100)}% of $${capUsd.toFixed(4)} cap — breached ✗`;
  const filled = Math.max(0, Math.min(10, Math.round((spentUsd / capUsd) * 10)));
  const fill = MONO ? "▓" : "🟩";
  const empty = MONO ? "░" : "⬜";
  return fill.repeat(filled) + empty.repeat(10 - filled) + ` ${Math.round((spentUsd / capUsd) * 100)}% of $${capUsd.toFixed(4)} cap`;
}

/** Chip only attribution lines (`> **Name —**`) — never names inside quoted bodies. */
function chipAttributions(dissentBody: string): string {
  if (MONO) return dissentBody;
  return dissentBody.replace(
    /^(>\s*\*\*)(Claude|GPT|Gemini|Grok|DeepSeek)(\s*—)/gm,
    (_m, pre: string, name: AdvisorName, post: string) => `${pre}${SEAT[name].chip} ${name}${post}`,
  );
}

function firstSentence(text: string, max = 64): string {
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return sentence.length <= max ? sentence : sentence.slice(0, max - 1).trimEnd() + "…";
}

const STATUS_MARK: Record<AdvisorOutcome["status"], string> = {
  ok: "",
  malformed: "◐ ",
  error: "✗ ",
};

function verdictDiff(verdicts: AdvisorVerdict[]): string[] {
  if (verdicts.length === 0 || verdicts.every((v) => v.verdict === "unspecified")) return [];
  const lines = verdicts.map((v) => {
    const prefix = v.verdict === "adopt" ? "+" : v.verdict === "reject" ? "-" : " ";
    const word = { adopt: "adopts", reject: "rejects", partial: "partial", abstain: "abstain", open: "open", unspecified: "—" }[v.verdict];
    return `${prefix} ${word.padEnd(8)} ${chip(v.advisor)} ${v.advisor.padEnd(9)}${v.note ? ` ${v.note}` : ""}`;
  });
  return ["## VERDICTS", "", "```diff", ...lines, "```", ""];
}

function estimateBlock(plan: CouncilPlan): string {
  const advisors = plan.advisors
    .map((a) => `${a.name} → ${a.available ? a.modelId : "(skipped)"}`)
    .join(", ");
  const notices = plan.advisors.filter((a) => a.notice).map((a) => `${a.name} ${a.notice}`);
  const lines = [
    `\`stakes\` est **$${plan.estimateUsd.toFixed(4)}** of $${plan.budgetUsd.toFixed(4)} · ` +
      `tier ${plan.tier}${plan.downgraded ? ` ⚠ downgraded from ${plan.requestedTier}` : ""}`,
    `Advisors: ${advisors} | synth: ${plan.synthModelId ?? "none"}`,
  ];
  if (notices.length > 0) lines.push(`Notices: ${notices.join("; ")}`);
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
      costUsd: outcome.costUsd,
    };
  }
  return {
    advisor: outcome.advisor,
    modelId: outcome.modelId,
    confidence: 0,
    position: `${outcome.status.toUpperCase()}: ${outcome.detail ?? "no detail"}`,
    uncertainties: [],
    selfObjection: "n/a",
    costUsd: outcome.costUsd,
  };
}

function renderCouncil(
  question: string,
  stakes: Stakes,
  plan: CouncilPlan,
  result: CouncilResult,
  latencyMs: number,
  ledgerPath: string,
): string {
  const highStakes = stakes === "high" || stakes === "audited";
  const ok = result.outcomes.filter((o) => o.status === "ok");
  const failed = result.outcomes.filter((o) => o.status !== "ok");
  const skipped = plan.advisors.filter((a) => !a.available);
  const degraded = failed.length > 0 || result.capBreached || !result.dissentAdjudicated;
  const dissentTopics = (result.dissent.match(/^#{1,4}\s/gm) ?? []).length;

  const lines: string[] = [
    `# 🏛️ SYMPOSIUM — ${degraded ? "convening degraded" : "the council is convened"}`,
    ``,
    `> **${question}**`,
    ``,
    `\`stakes ${stakes}\` · \`tier ${plan.tier}\`${plan.downgraded ? ` ⚠ downgraded from ${plan.requestedTier}` : ""} · ` +
      `\`${ok.length} of ${plan.advisors.length} voices\` · \`synth ${plan.synthModelId ?? "none"}\` · ` +
      `\`est $${plan.estimateUsd.toFixed(4)} of $${plan.budgetUsd.toFixed(4)}\``,
    ``,
  ];

  if (highStakes) {
    lines.push(
      `> ⚠️ **${stakes.toUpperCase()} STAKES — this council will not conclude.** It ends with the questions a human must answer.`,
      ``,
    );
  }

  if (failed.length > 0 || result.capBreached) {
    lines.push(DEGRADED_BAND, ``, `## ⚠ THE RECORD IS INCOMPLETE`, ``, DEGRADED_BAND, ``);
    for (const o of failed) {
      lines.push(
        `- \`${o.status === "malformed" ? "◐" : "✗"}\` ${chip(o.advisor)} **${o.advisor}** (\`${o.modelId}\`) — ${o.status}: ${o.detail ?? "no detail"}`,
      );
    }
    if (result.capBreached) {
      lines.push(
        `- \`✗\` **Synthesis** — aborted before it ran: actual spend reached the cap. Positions already returned are preserved.`,
      );
    }
    lines.push(``);
  }

  const floorChips = ok.map((o) => chip(o.advisor)).join("");
  const silentChips = failed.map((o) => chip(o.advisor)).join("");
  lines.push(
    `## THE FLOOR · ${floorChips}${silentChips ? ` spoke · ${silentChips} silent` : ""}`,
    ``,
    `| Voice | Confidence | Stance |`,
    `|---|---|---|`,
  );
  for (const o of ok) {
    lines.push(
      `| ${chip(o.advisor)} ${o.advisor} | ${bar(o.advisor, o.reply?.confidence ?? 0)} ${(o.reply?.confidence ?? 0).toFixed(2)} | ${firstSentence(o.reply?.position ?? "")} |`,
    );
  }
  for (const o of failed) {
    lines.push(
      `| ${STATUS_MARK[o.status]}${chip(o.advisor)} ${o.advisor} | ${EMPTY_BAR} | *no position — ${o.status}* |`,
    );
  }
  for (const seat of skipped) {
    lines.push(`| ○ ${seat.name} | ${EMPTY_BAR} | *seat empty — no API key* |`);
  }
  lines.push(``);

  for (const o of ok) {
    const reply = o.reply;
    if (!reply) continue;
    lines.push(
      `#### ${chip(o.advisor)} ${o.advisor} · \`${o.modelId}\` · cost $${o.costUsd.toFixed(4)}`,
      ``,
      `${bar(o.advisor, reply.confidence)} **${reply.confidence.toFixed(2)}**`,
      ``,
      reply.position,
      ``,
    );
    if (reply.key_uncertainties.length > 0)
      lines.push(`- △ *Least sure:* ${reply.key_uncertainties[0]}`);
    lines.push(`- ▲ *Own objection:* ${reply.strongest_objection_to_own_position}`);
    if (reply.dissent_from_framing)
      lines.push(`- ⚠ *Dissents from the framing:* ${reply.dissent_from_framing}`);
    lines.push(``);
  }

  if (result.dissentAdjudicated) {
    lines.push(
      BAND,
      ``,
      `## ⚖ DISSENT${dissentTopics > 0 ? ` — ${dissentTopics} material disagreement${dissentTopics === 1 ? "" : "s"}, verbatim` : ""}`,
      ``,
      BAND,
      ``,
      chipAttributions(result.dissent),
      ``,
    );
  } else {
    lines.push(BROKEN_BAND, ``, `## ⚖ DISSENT — NOT ADJUDICATED`, ``, BROKEN_BAND, ``);
    lines.push(
      `**No synthesizer adjudicated this disagreement.** The quotes below are excerpted mechanically from the positions above — the reader is the synthesizer.`,
      ``,
    );
    for (const o of ok) {
      lines.push(`> **${chip(o.advisor)} ${o.advisor} —** "${firstSentence(o.reply?.position ?? "", 120)}"`, `>`);
    }
    if (lines[lines.length - 1] === ">") lines.pop();
    lines.push(``, result.dissent, ``);
  }

  lines.push(...verdictDiff(result.verdicts));

  lines.push(highStakes ? `## † OPEN QUESTIONS FOR THE HUMAN` : `## § SYNTHESIS`, ``, result.synthesis, ``);

  const adjourned = result.capBreached
    ? "adjourned over cap"
    : highStakes
      ? "adjourned without conclusion"
      : degraded
        ? "adjourned incomplete"
        : "adjourned";
  lines.push(
    `---`,
    ``,
    `\`${adjourned}\` · **$${result.totalCostUsd.toFixed(4)}** actual (est $${plan.estimateUsd.toFixed(4)}) · ${(latencyMs / 1000).toFixed(1)} s`,
    ``,
    budgetMeter(result.totalCostUsd, plan.budgetUsd, result.capBreached),
    ``,
    `\`ledger\` → \`${ledgerPath}\``,
  );

  return lines.join("\n");
}

const server = new McpServer({ name: "symposium", version: "0.6.0" });

server.registerTool(
  "convene_council",
  {
    title: "Convene the council",
    description:
      "Convene a council of AI advisors (Claude, GPT, Gemini, Grok, DeepSeek) on one question. " +
      "Fans out to live advisors in parallel, surfaces disagreement verbatim in a DISSENT " +
      "section with per-advisor verdicts, synthesizes (or, for high/audited stakes, stops " +
      "with open questions for the human), and writes the full deliberation to a Markdown " +
      "ledger (schema v2). Cost is estimated pre-flight and enforced against a budget; " +
      "set dry_run to preview the estimate without calling any provider or writing a ledger.",
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

    const plan = planCouncil(
      { question, context, stakes: stakes as Stakes, budget_usd },
      process.env,
      catalog,
    );

    if (plan.refusal) {
      const text = [
        `# 🏛️ SYMPOSIUM — the council refuses`,
        ``,
        `> **${question}**`,
        ``,
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
        `# 🏛️ SYMPOSIUM — dry run`,
        ``,
        `> **${question}**`,
        ``,
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
        costUsd: 0,
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
      verdicts: result.verdicts,
      synthesis: result.synthesis,
      relations: [],
    });

    const text = renderCouncil(question, stakes as Stakes, plan, result, latencyMs, ledgerPath);
    return { content: [{ type: "text", text }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("symposium MCP server ready (stdio)");
