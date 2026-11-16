import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { ProviderAdapter } from "./types.js";

/**
 * Strict JSON Schema mirroring `advisorReplySchema` in `council.ts` (kept inline to
 * avoid circular imports). Paired with `ThinkingLevel.LOW` on advisor calls so
 * frontier Gemini models do not exhaust `maxOutputTokens` on unconstrained internal
 * reasoning and truncate mid-JSON (the P4 gate failure mode).
 */
export const ADVISOR_JSON_SCHEMA = {
  type: "object",
  properties: {
    position: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    key_uncertainties: { type: "array", items: { type: "string" } },
    strongest_objection_to_own_position: { type: "string" },
    dissent_from_framing: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: [
    "position",
    "confidence",
    "key_uncertainties",
    "strongest_objection_to_own_position",
    "dissent_from_framing",
  ],
  additionalProperties: false,
} as const;

let client: GoogleGenAI | undefined;

export const googleAdapter: ProviderAdapter = {
  provider: "google",
  async complete(modelId, prompt, maxOutputTokens, options) {
    client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await client.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        maxOutputTokens,
        // Native JSON schema + low thinking cap for the advisor contract; synthesis wants markdown.
        ...(options.json
          ? {
              responseMimeType: "application/json",
              responseJsonSchema: ADVISOR_JSON_SCHEMA,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            }
          : {}),
      },
    });

    const usage = response.usageMetadata;
    return {
      text: response.text ?? "",
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        // Gemini reports thinking separately; it bills as output.
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      },
    };
  },
};
