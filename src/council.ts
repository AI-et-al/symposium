import { z } from "zod";
import type { Stakes } from "./ledger.js";
import {
  ADVISOR_TOKENS,
  MAX_SYNTH_TOKENS,
  retainedPriced,
  type AdvisorName,
  type Catalog,
  type CouncilPlan,
  type ModelEntry,
  type Priced,
  type Provenance,
  type Provider,
  type RetainedProvider,
} from "./router.js";
import { anthropicAdapter } from "./providers/anthropic.js";
import { deepseekAdapter } from "./providers/deepseek.js";
import { googleAdapter } from "./providers/google.js";
import { openaiAdapter } from "./providers/openai.js";
import {
  claudeCliAdapter,
  codexCliAdapter,
  geminiCliAdapter,
  RETAINED_TIMEOUT_MS,
} from "./providers/retained.js";
import { xaiAdapter } from "./providers/xai.js";
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
  /** Seat provenance (ledger schema v3); set by conveneCouncil, neutral when absent. */
  provenance?: Provenance;
}

export type Verdict = "adopt" | "reject" | "partial" | "abstain" | "open" | "unspecified";

export interface AdvisorVerdict {
  advisor: AdvisorName;
  verdict: Verdict;
  note?: string;
}

export interface CouncilResult {
  outcomes: AdvisorOutcome[];
  /** Markdown body of the DISSENT section (the ledger adds the heading). */
  dissent: string;
  /** Machine-readable per-advisor verdicts (ledger schema v2); empty when synthesis never ran. */
  verdicts: AdvisorVerdict[];
  synthesis: string;
  totalCostUsd: number;
  /** True when actual spend hit the budget cap mid-flight and synthesis was skipped. */
  capBreached: boolean;
  /** False when no synthesizer completed — the dissent body is a marker, not an adjudication. */
  dissentAdjudicated: boolean;
}

export const DEFAULT_ADAPTERS: Record<Provider, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  google: googleAdapter,
  xai: xaiAdapter,
  deepseek: deepseekAdapter,
  "claude-cli": claudeCliAdapter,
  "codex-cli": codexCliAdapter,
  "gemini-cli": geminiCliAdapter,
};

/** Per-advisor call ceiling (spec §5 P4: 60s/advisor); applies to first call and retry separately. */
export const ADVISOR_TIMEOUT_MS = 60_000;
/** Synthesis reads N positions and thinks before writing — it earns more rope than an advisor. */
export const SYNTH_TIMEOUT_MS = 120_000;

/** Actual-usage spend, shared across the convening; the hard cap the estimate only predicted. */
export interface CostCap {
  capUsd: number;
  spentUsd: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Provider error messages sometimes echo credentials (OpenAI 401s quote the key).
 * Nothing key-shaped may reach the ledger or the tool response (spec §4).
 */
export function redactSecrets(text: string): string {
  // Word boundaries + length floors keep prose like "risk-tolerant" intact.
  return text
    .replace(/\bsk-[A-Za-z0-9_*-]{10,}/g, "[redacted-key]")
    .replace(/\bAIza[A-Za-z0-9_-]{10,}/g, "[redacted-key]")
    .replace(/\bxai-[A-Za-z0-9_-]{12,}/g, "[redacted-key]");
}

export function costOf(model: Priced, usage: CompletionUsage): number {
  return (usage.inputTokens / 1e6) * model.in_per_mtok + (usage.outputTokens / 1e6) * model.out_per_mtok;
}

export function advisorPrompt(
  name: AdvisorName,
  question: string,
  context?: string,
  provenance: Provenance = "neutral",
): string {
  return [
    `You are ${name}, one advisor on a council of AI models. Answer independently; the other advisors cannot see your reply.`,
    ...(provenance === "retained"
      ? [
          `You are a retained seat: you run under your operator's own subscription and may carry their context. ` +
            `Answer as informed counsel — where operator-specific knowledge shapes your answer, say so.`,
        ]
      : []),
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
  const seatLabel = (o: AdvisorOutcome) =>
    `${o.modelId}${o.provenance === "retained" ? " — retained seat, carries its operator's context" : ""}`;
  const positions = outcomes
    .filter((o) => o.status === "ok" && o.reply)
    .map((o) => `### ${o.advisor} (${seatLabel(o)})\n${JSON.stringify(o.reply, null, 2)}`)
    .join("\n\n");
  const casualties = outcomes
    .filter((o) => o.status !== "ok")
    .map((o) => `- ${o.advisor} (${o.modelId}): ${o.status} — has no position`)
    .join("\n");

  const highStakes = stakes === "high" || stakes === "audited";
  const names = outcomes.map((o) => o.advisor).join(", ");

  return [
    SYNTHESIS_RULES,
    ``,
    `Stakes: ${stakes}`,
    ``,
    `Format your reply as exactly three markdown sections, in this order:`,
    ``,
    `## DISSENT`,
    `One '### N · <short topic>' subheading per material disagreement. Under each, quote the`,
    `disagreeing advisors verbatim as blockquotes in exactly this shape:`,
    `> **<AdvisorName> —** "<verbatim quote>"`,
    `If there is no material dissent, write exactly: - *No material dissent recorded.*`,
    ``,
    `## VERDICTS`,
    `Exactly one line per advisor (${names}), machine-readable, in exactly this shape:`,
    `- <AdvisorName>: <verdict> — <one short clause of reason>`,
    highStakes
      ? `Since stakes are high/audited you must not conclude: use the verdict 'open' for advisors whose positions remain live, 'abstain' for advisors without a position.`
      : `Verdict is one of: adopt, reject, partial (adopted with qualifications), abstain (no position or not judged).`,
    ``,
    `## SYNTHESIS`,
    highStakes
      ? `Per rule (3): do NOT conclude — lay out the tension, then end with the 2-4 questions a human must answer.`
      : `Your synthesis as prose, stating which advisor positions it adopts, which it rejects, and why. The prose must agree with the VERDICTS lines.`,
    ``,
    `Question the council was asked: ${question}`,
    ...(context ? [``, `Context: ${context}`] : []),
    ``,
    `Advisor positions (JSON, verbatim):`,
    ``,
    positions,
    ...(casualties ? [``, `Advisors without a position (do not invent views for them; verdict them 'abstain'):`, casualties] : []),
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
  model: Priced,
  prompt: string,
  cap: CostCap,
  opts: { maxTokens?: number; timeoutMs?: number } = {},
): Promise<AdvisorOutcome> {
  const maxTokens = opts.maxTokens ?? ADVISOR_TOKENS.low;
  const timeoutMs = opts.timeoutMs ?? ADVISOR_TIMEOUT_MS;
  let costUsd = 0;
  const charge = (usage: CompletionUsage) => {
    const cost = costOf(model, usage);
    costUsd += cost;
    cap.spentUsd += cost;
  };

  try {
    let completion = await withTimeout(
      adapter.complete(model.id, prompt, maxTokens, { json: true }),
      timeoutMs,
      `${name} advisor call`,
    );
    charge(completion.usage);
    let reply = parseReply(completion.text);

    if (!reply) {
      if (cap.spentUsd >= cap.capUsd) {
        return {
          advisor: name,
          modelId: model.id,
          status: "malformed",
          detail: "invalid JSON; retry skipped — budget cap breached mid-flight",
          costUsd,
        };
      }
      completion = await withTimeout(
        adapter.complete(model.id, prompt + RETRY_SUFFIX, maxTokens, { json: true }),
        timeoutMs,
        `${name} retry call`,
      );
      charge(completion.usage);
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
      detail: redactSecrets(err instanceof Error ? err.message : String(err)),
      costUsd,
    };
  }
}

/** One verdict line per advisor, tolerant of bolding and dash variants; unmatched → unspecified. */
export function parseVerdicts(body: string, advisors: AdvisorName[]): AdvisorVerdict[] {
  return advisors.map((advisor) => {
    const re = new RegExp(
      `^[-*]\\s*\\**${advisor}\\**\\s*:\\s*\\**(adopt|reject|partial|abstain|open)\\**\\b(?:\\s*[—–-]+\\s*(.*))?`,
      "im",
    );
    const match = re.exec(body);
    return match
      ? {
          advisor,
          verdict: match[1].toLowerCase() as Verdict,
          ...(match[2] ? { note: match[2].trim() } : {}),
        }
      : { advisor, verdict: "unspecified" as Verdict };
  });
}

export interface SynthSections {
  dissent: string;
  verdicts: AdvisorVerdict[];
  synthesis: string;
}

/** Splits the synthesizer's output into DISSENT, VERDICTS, and SYNTHESIS bodies. */
export function splitSynthOutput(text: string, advisors: AdvisorName[]): SynthSections {
  const dissentMatch = /^#{1,3}\s*DISSENT\s*$/im.exec(text);
  const verdictsMatch = /^#{1,3}\s*VERDICTS\s*$/im.exec(text);
  const synthMatch = /^#{1,3}\s*(?:SYNTHESIS|OPEN QUESTIONS[^\n]*)\s*$/im.exec(text);
  if (!dissentMatch || !synthMatch || synthMatch.index < dissentMatch.index) {
    // Manifesto: a synthesis that buries dissent is a bug of the highest severity — make it loud.
    return {
      dissent: "*SYNTHESIZER FORMAT FAILURE — dissent section missing; full output preserved under Synthesis.*",
      verdicts: advisors.map((advisor) => ({ advisor, verdict: "unspecified" as Verdict })),
      synthesis: text.trim(),
    };
  }
  const haveVerdicts =
    verdictsMatch && verdictsMatch.index > dissentMatch.index && verdictsMatch.index < synthMatch.index;
  const dissentEnd = haveVerdicts ? verdictsMatch.index : synthMatch.index;
  const verdictsBody = haveVerdicts
    ? text.slice(verdictsMatch.index + verdictsMatch[0].length, synthMatch.index)
    : "";
  return {
    dissent: text.slice(dissentMatch.index + dissentMatch[0].length, dissentEnd).trim(),
    verdicts: parseVerdicts(verdictsBody, advisors),
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
  timeouts: { advisorMs?: number; synthMs?: number } = {},
): Promise<CouncilResult> {
  const seats = plan.advisors.filter((a) => a.available && a.modelId);
  const cap: CostCap = { capUsd: plan.budgetUsd, spentUsd: 0 };

  const settled = await Promise.allSettled(
    seats.map((seat) =>
      runAdvisor(
        adapters[seat.provider],
        seat.name,
        seat.provenance === "retained"
          ? retainedPriced(seat.provider as RetainedProvider)
          : entryById(catalog, seat.modelId as string),
        advisorPrompt(seat.name, input.question, input.context, seat.provenance),
        cap,
        {
          maxTokens: ADVISOR_TOKENS[plan.tier],
          // CLI seats pay spawn/auth/queue overhead an API call does not; parallel
          // fan-out makes the longer rope nearly free (see providers/retained.ts).
          timeoutMs:
            timeouts.advisorMs ??
            (seat.provenance === "retained" ? RETAINED_TIMEOUT_MS : undefined),
        },
      ),
    ),
  );
  const outcomes: AdvisorOutcome[] = settled.map((result, i) =>
    result.status === "fulfilled"
      ? { ...result.value, provenance: seats[i].provenance }
      : {
          advisor: seats[i].name,
          modelId: seats[i].modelId as string,
          status: "error",
          detail: String(result.reason),
          costUsd: 0,
          provenance: seats[i].provenance,
        },
  );

  let dissent = "";
  let synthesis = "";
  let verdicts: AdvisorVerdict[] = [];
  let synthCostUsd = 0;
  let capBreached = false;
  let dissentAdjudicated = false;

  const okCount = outcomes.filter((o) => o.status === "ok").length;
  if (okCount === 0 || !plan.synthModelId) {
    dissent = "*No positions returned — every advisor failed; nothing to dissent from.*";
    synthesis = "No synthesis possible: the council returned no valid positions.";
  } else if (cap.spentUsd >= cap.capUsd) {
    // Hard cap enforced against ACTUAL usage (spec §3): advisors already returned are
    // kept and recorded; the remaining call (synthesis) is aborted.
    capBreached = true;
    dissent = "*Synthesis aborted — budget cap breached mid-flight; no dissent extraction performed.*";
    synthesis =
      `BUDGET CAP BREACHED: actual spend $${cap.spentUsd.toFixed(4)} reached the cap ` +
      `$${cap.capUsd.toFixed(4)} before synthesis. Advisor positions above are preserved; ` +
      `re-convene with a higher budget_usd to synthesize.`;
  } else {
    const synthModel = entryById(catalog, plan.synthModelId);
    const completion = await withTimeout(
      adapters[synthModel.provider].complete(
        synthModel.id,
        synthesisPrompt(input.question, input.stakes, outcomes, input.context),
        MAX_SYNTH_TOKENS,
        { json: false },
      ),
      timeouts.synthMs ?? SYNTH_TIMEOUT_MS,
      "synthesis call",
    ).then(
      (c) => c,
      (err) => {
        // A failed synthesizer must not sink the convening: preserve positions, mark loudly.
        dissent = "*Synthesis failed — no dissent extraction performed.*";
        synthesis = `SYNTHESIS FAILED: ${redactSecrets(err instanceof Error ? err.message : String(err))}. Advisor positions above are preserved.`;
        return null;
      },
    );
    if (completion) {
      synthCostUsd = costOf(synthModel, completion.usage);
      cap.spentUsd += synthCostUsd;
      ({ dissent, verdicts, synthesis } = splitSynthOutput(
        completion.text,
        outcomes.map((o) => o.advisor),
      ));
      dissentAdjudicated = true;
    }
  }

  const totalCostUsd = outcomes.reduce((sum, o) => sum + o.costUsd, 0) + synthCostUsd;
  return { outcomes, dissent, verdicts, synthesis, totalCostUsd, capBreached, dissentAdjudicated };
}
