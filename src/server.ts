#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  conveneCouncil,
  type AdvisorOutcome,
  type CouncilResult,
} from "./council.js";
import { writeLedger, type AdvisorPosition, type Stakes } from "./ledger.js";
import {
  loadCatalog,
  parseRetainedTokens,
  planCouncil,
  RETAINED_SEATS,
  type CouncilPlan,
  type RetainedToken,
} from "./router.js";
import {
  BAND,
  bar,
  BROKEN_BAND,
  budgetMeter,
  chip,
  chipAttributions,
  DEGRADED_BAND,
  EMPTY_BAR,
  firstSentence,
  STATUS_MARK,
  verdictDiff,
} from "./theme.js";

const catalog = loadCatalog(); // fail fast on a malformed models.json

// Retained seats: detect opted-in CLIs once at startup. A subscription CLI is never
// probed, let alone invoked, unless its token appears in SYMPOSIUM_RETAINED_SEATS.
const { tokens: retainedTokens, unknown: unknownRetainedTokens } = parseRetainedTokens(
  process.env.SYMPOSIUM_RETAINED_SEATS,
);
const cliAvailable: Partial<Record<RetainedToken, boolean>> = {};
for (const token of retainedTokens) {
  const seat = RETAINED_SEATS.find((s) => s.token === token)!;
  const finder = process.platform === "win32" ? "where" : "which";
  cliAvailable[token] = spawnSync(finder, [seat.command], { stdio: "ignore" }).status === 0;
}
if (unknownRetainedTokens.length > 0) {
  console.error(
    `symposium: ignoring unknown retained seat token(s): ${unknownRetainedTokens.join(", ")} (known: claude, codex, gemini)`,
  );
}

function estimateBlock(plan: CouncilPlan): string {
  const advisors = plan.advisors
    .map((a) => `${a.name} → ${a.available ? a.modelId : "(skipped)"}${a.provenance === "retained" && a.available ? " (retained)" : ""}`)
    .join(", ");
  const notices = [
    ...plan.advisors.filter((a) => a.notice).map((a) => `${a.name} ${a.notice}`),
    ...plan.notices,
  ];
  const lines = [
    `\`stakes\` est **$${plan.estimateUsd.toFixed(4)}** of $${plan.budgetUsd.toFixed(4)} · ` +
      `tier ${plan.tier}${plan.downgraded ? ` ⚠ downgraded from ${plan.requestedTier}` : ""}`,
    `Advisors: ${advisors} | synth: ${plan.synthModelId ?? "none"}`,
  ];
  if (notices.length > 0) lines.push(`Notices: ${notices.join("; ")}`);
  return lines.join("\n");
}

function positionOf(outcome: AdvisorOutcome): AdvisorPosition {
  const provenance = outcome.provenance ?? "neutral";
  // Retained seats are unmetered — the spec says omit cost rather than record a fake $0.
  const costUsd = provenance === "retained" ? undefined : outcome.costUsd;
  if (outcome.status === "ok" && outcome.reply) {
    const framing = outcome.reply.dissent_from_framing;
    return {
      advisor: outcome.advisor,
      modelId: outcome.modelId,
      provenance,
      confidence: outcome.reply.confidence,
      position:
        outcome.reply.position + (framing ? `\n\n*Dissent from framing:* ${framing}` : ""),
      uncertainties: outcome.reply.key_uncertainties,
      selfObjection: outcome.reply.strongest_objection_to_own_position,
      costUsd,
    };
  }
  return {
    advisor: outcome.advisor,
    modelId: outcome.modelId,
    provenance,
    confidence: 0,
    position: `${outcome.status.toUpperCase()}: ${outcome.detail ?? "no detail"}`,
    uncertainties: [],
    selfObjection: "n/a",
    costUsd,
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
      `\`${ok.length} of ${plan.advisors.length} voices\` · \`synth ${result.synthModelId ?? plan.synthModelId ?? "none"}\` · ` +
      `\`est $${plan.estimateUsd.toFixed(4)} of $${plan.budgetUsd.toFixed(4)}\``,
    ``,
  ];

  if (result.synthNote) {
    lines.push(`> ⚠ ${result.synthNote}`, ``);
  }

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
    const why = seat.notice?.replace(/^skipped — /, "") ?? "unavailable";
    lines.push(`| ○ ${seat.name} | ${EMPTY_BAR} | *seat empty — ${why}* |`);
  }
  lines.push(``);

  for (const o of ok) {
    const reply = o.reply;
    if (!reply) continue;
    const seatBadge =
      o.provenance === "retained" ? ` · retained — no API metering` : ` · cost $${o.costUsd.toFixed(4)}`;
    lines.push(
      `#### ${chip(o.advisor)} ${o.advisor} · \`${o.modelId}\`${seatBadge}`,
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

const server = new McpServer({ name: "symposium", version: "0.8.0" });

server.registerTool(
  "convene_council",
  {
    title: "Convene the council",
    description:
      "Convene a council of AI advisors (Claude, GPT, Gemini, Grok, DeepSeek, Qwen — plus opted-in " +
      "retained seats held by the operator's own subscription CLIs) on one question. " +
      "Fans out to live advisors in parallel, surfaces disagreement verbatim in a DISSENT " +
      "section with per-advisor verdicts, synthesizes (or, for high/audited stakes, stops " +
      "with open questions for the human), and writes the full deliberation to a Markdown " +
      "ledger (schema v3, with seat provenance). Cost is estimated pre-flight and enforced " +
      "against a budget; set dry_run to preview the estimate without calling any provider " +
      "or writing a ledger.",
    inputSchema: {
      question: z.string().min(1, "question must be non-empty"),
      context: z.string().optional(),
      stakes: z.enum(["low", "medium", "high", "audited"]),
      budget_usd: z.number().positive().optional(),
      dry_run: z.boolean().optional(),
    },
  },
  async ({ question, context, stakes, budget_usd, dry_run }, extra) => {
    const started = Date.now();

    // Coarse lifecycle progress only when the client asked for it (per the v2
    // streaming ruling: stage events, never token streaming; result stays atomic).
    const progressToken = extra._meta?.progressToken;
    const onProgress =
      progressToken === undefined
        ? undefined
        : (message: string, progress: number, total: number) => {
            void extra
              .sendNotification({
                method: "notifications/progress",
                params: { progressToken, progress, total, message },
              })
              .catch(() => {}); // a dropped notification must never sink a convening
          };

    const plan = planCouncil(
      { question, context, stakes: stakes as Stakes, budget_usd },
      process.env,
      catalog,
      cliAvailable,
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
      undefined,
      { onProgress },
    );

    const skippedSeats: AdvisorPosition[] = plan.advisors
      .filter((a) => !a.available)
      .map((a) => ({
        advisor: a.name,
        modelId: "skipped",
        provenance: a.provenance,
        confidence: 0,
        position: `Skipped: ${a.notice}`,
        uncertainties: [],
        selfObjection: "n/a",
        ...(a.provenance === "retained" ? {} : { costUsd: 0 }),
      }));
    const positions = [...result.outcomes.map(positionOf), ...skippedSeats];
    const latencyMs = Date.now() - started;

    const ledgerPath = writeLedger({
      date: new Date(started),
      question,
      context,
      stakes: stakes as Stakes,
      advisorModelIds: result.outcomes.map((o) =>
        o.provenance === "retained" ? `retained: ${o.modelId}` : o.modelId,
      ),
      // The seat that actually adjudicated (fallbacks included); the elected-but-
      // failed synthesizer when none did — failed seats stay in the record.
      synthModelId: result.synthModelId ?? plan.synthModelId ?? "none",
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
