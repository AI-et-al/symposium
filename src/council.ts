import { z } from "zod";
import type { Stakes } from "./ledger.js";
import {
  MAX_ADVISOR_TOKENS,
  MAX_SYNTH_TOKENS,
  type AdvisorName,
  type Catalog,
  type CouncilPlan,
  type ModelEntry,
  type Provider,
} from "./router.js";
import { anthropicAdapter } from "./providers/anthropic.js";
import { googleAdapter } from "./providers/google.js";
import { openaiAdapter } from "./providers/openai.js";
import type { CompletionUsage, ProviderAdapter } from "./providers/types.js";

/** Advisor response contract (spec §2) — strict JSON, one retry, then malformed. */
export const advisorReplySchema = z.object({
  position: z.string().min(1),
  confidence: z.number().min(0).max(1),
  key_uncertainties: z.array(z.string()),
  strongest_objection_to_own_position: z.string(),
  dissent_from_framing: z.string().nullable(),
});
export type AdvisorReply = z.infer<typeof advisorReplySchema>;

export interface AdvisorOutcome {
  advisor: AdvisorName;
  modelId: string;
  status: "ok" | "malformed" | "error";
  reply?: AdvisorReply;
  /** Error message or parse-failure note for malformed/error outcomes. */
  detail?: string;
  costUsd: number;
}

export interface CouncilResult {
  outcomes: AdvisorOutcome[];
  /** Markdown body of the DISSENT section (the ledger adds the heading). */
  dissent: string;
  synthesis: string;
  totalCostUsd: number;
}

export const DEFAULT_ADAPTERS: Record<Provider, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
};

export function costOf(model: ModelEntry, usage: CompletionUsage): number {
  return (usage.inputTokens / 1e6) * model.in_per_mtok + (usage.outputTokens / 1e6) * model.out_per_mtok;
}

export function advisorPrompt(name: AdvisorName, question: string, context?: string): string {
  return [
    `You are ${name}, one advisor on a three-model AI council. Answer independently; the other advisors cannot see your reply.`,
    ``,
    `Question: ${question}`,
    ...(context ? [``, `Context: ${context}`] : []),
    ``,
    `Reply with ONLY a JSON object — no markdown fences, no prose before or after — in exactly this shape:`,
    `{`,
    `  "position": "your answer, at most 300 words",`,
    `  "confidence": 0.0,`,
    `  "key_uncertainties": ["what you are least sure about"],`,
    `  "strongest_objection_to_own_position": "the best argument against your own position",`,
    `  "dissent_from_framing": "if the question itself is wrongly framed, say how — otherwise null"`,
    `}`,
    ``,
    `"confidence" is a number between 0.0 and 1.0. "dissent_from_framing" is a string or null.`,
  ].join("\n");
}

const RETRY_SUFFIX =
  "\n\nYour previous reply was not a valid JSON object matching the required shape. " +
  "Reply again with ONLY the JSON object — no fences, no commentary.";

/** Synthesis core rule — spec §2, verbatim. */
const SYNTHESIS_RULES =
  "You are the synthesizer for a council of AI advisors. Rules:\n" +
  "(1) You MUST reproduce each material disagreement between advisors verbatim, " +
  "attributed by advisor name, in a section titled DISSENT. Never average, " +
  "soften, or omit a disagreement.\n" +
  "(2) Only after the DISSENT section may you offer a synthesis, and it must state " +
  "which advisor positions it adopts and which it rejects, and why.\n" +
  "(3) If stakes are high or audited, do not conclude: end with the 2–4 questions " +
  "a human must answer to resolve the dissent.";

export function synthesisPrompt(
  question: string,
  stakes: Stakes,
  outcomes: AdvisorOutcome[],
  context?: string,
): string {
  const positions = outcomes
    .filter((o) => o.status === "ok" && o.reply)
    .map((o) => `### ${o.advisor} (${o.modelId})\n${JSON.stringify(o.reply, null, 2)}`)
    .join("\n\n");
  const casualties = outcomes
    .filter((o) => o.status !== "ok")
    .map((o) => `- ${o.advisor} (${o.modelId}): ${o.status} — has no position`)
    .join("\n");

  return [
    SYNTHESIS_RULES,
    ``,
    `Stakes: ${stakes}`,
    ``,
    `Format your reply as exactly two markdown sections:`,
    `## DISSENT`,
    `A bullet list — one bullet per point of disagreement, quoting each advisor verbatim, ` +
      `attributed by name. If there is no material dissent, write exactly: - *No material dissent recorded.*`,
    `## SYNTHESIS`,
    stakes === "high" || stakes === "audited"
      ? `Per rule (3): do NOT conclude — lay out the tension, then end with the 2-4 questions a human must answer.`
      : `Your synthesis, stating which advisor positions it adopts, which it rejects, and why.`,
    ``,
    `Question the council was asked: ${question}`,
    ...(context ? [``, `Context: ${context}`] : []),
    ``,
    `Advisor positions (JSON, verbatim):`,
    ``,
    positions,
    ...(casualties ? [``, `Advisors without a position (do not invent views for them):`, casualties] : []),
  ].join("\n");
}

/** Models often wrap JSON in code fences despite instructions; strip them before parsing. */
export function stripFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

export function parseReply(raw: string): AdvisorReply | null {
  try {
    const parsed = advisorReplySchema.safeParse(JSON.parse(stripFences(raw)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** One advisor call with the contract's single retry. Never throws — a council survives a confused member. */
export async function runAdvisor(
  adapter: ProviderAdapter,
  name: AdvisorName,
  model: ModelEntry,
  prompt: string,
): Promise<AdvisorOutcome> {
  let costUsd = 0;
  try {
    let completion = await adapter.complete(model.id, prompt, MAX_ADVISOR_TOKENS, { json: true });
    costUsd += costOf(model, completion.usage);
    let reply = parseReply(completion.text);

    if (!reply) {
      completion = await adapter.complete(model.id, prompt + RETRY_SUFFIX, MAX_ADVISOR_TOKENS, {
        json: true,
      });
      costUsd += costOf(model, completion.usage);
      reply = parseReply(completion.text);
    }

    return reply
      ? { advisor: name, modelId: model.id, status: "ok", reply, costUsd }
      : {
          advisor: name,
          modelId: model.id,
          status: "malformed",
          detail: "reply was not valid JSON matching the contract, after one retry",
          costUsd,
        };
  } catch (err) {
    return {
      advisor: name,
      modelId: model.id,
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
      costUsd,
    };
  }
}

/** Splits the synthesizer's output into DISSENT and SYNTHESIS bodies. */
export function splitSynthOutput(text: string): { dissent: string; synthesis: string } {
  const dissentMatch = /^#{1,3}\s*DISSENT\s*$/im.exec(text);
  const synthMatch = /^#{1,3}\s*(?:SYNTHESIS|OPEN QUESTIONS)\s*$/im.exec(text);
  if (!dissentMatch || !synthMatch || synthMatch.index < dissentMatch.index) {
    // Manifesto: a synthesis that buries dissent is a bug of the highest severity — make it loud.
    return {
      dissent: "*SYNTHESIZER FORMAT FAILURE — dissent section missing; full output preserved under Synthesis.*",
      synthesis: text.trim(),
    };
  }
  return {
    dissent: text.slice(dissentMatch.index + dissentMatch[0].length, synthMatch.index).trim(),
    synthesis: text.slice(synthMatch.index + synthMatch[0].length).trim(),
  };
}

function entryById(catalog: Catalog, id: string): ModelEntry {
  const entry = catalog.models.find((m) => m.id === id);
  if (!entry) throw new Error(`model ${id} not found in catalog`);
  return entry;
}

/** Fan out to all available advisors, then synthesize. Pre-flight gating already happened in the router. */
export async function conveneCouncil(
  input: { question: string; context?: string; stakes: Stakes },
  plan: CouncilPlan,
  catalog: Catalog,
  adapters: Record<Provider, ProviderAdapter> = DEFAULT_ADAPTERS,
): Promise<CouncilResult> {
  const seats = plan.advisors.filter((a) => a.available && a.modelId);

  const settled = await Promise.allSettled(
    seats.map((seat) =>
      runAdvisor(
        adapters[seat.provider],
        seat.name,
        entryById(catalog, seat.modelId as string),
        advisorPrompt(seat.name, input.question, input.context),
      ),
    ),
  );
  const outcomes: AdvisorOutcome[] = settled.map((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : {
          advisor: seats[i].name,
          modelId: seats[i].modelId as string,
          status: "error",
          detail: String(result.reason),
          costUsd: 0,
        },
  );

  let dissent: string;
  let synthesis: string;
  let synthCostUsd = 0;

  const okCount = outcomes.filter((o) => o.status === "ok").length;
  if (okCount === 0 || !plan.synthModelId) {
    dissent = "*No positions returned — every advisor failed; nothing to dissent from.*";
    synthesis = "No synthesis possible: the council returned no valid positions.";
  } else {
    const synthModel = entryById(catalog, plan.synthModelId);
    const completion = await adapters[synthModel.provider].complete(
      synthModel.id,
      synthesisPrompt(input.question, input.stakes, outcomes, input.context),
      MAX_SYNTH_TOKENS,
      { json: false },
    );
    synthCostUsd = costOf(synthModel, completion.usage);
    ({ dissent, synthesis } = splitSynthOutput(completion.text));
  }

  const totalCostUsd = outcomes.reduce((sum, o) => sum + o.costUsd, 0) + synthCostUsd;
  return { outcomes, dissent, synthesis, totalCostUsd };
}
