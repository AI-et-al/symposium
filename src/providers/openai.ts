import OpenAI from "openai";
import type { ProviderAdapter } from "./types.js";

let client: OpenAI | undefined;

export const openaiAdapter: ProviderAdapter = {
  provider: "openai",
  async complete(modelId, prompt, maxOutputTokens, options) {
    client ??= new OpenAI(); // lazy: the server must boot without keys

    const response = await client.responses.create({
      model: modelId,
      input: prompt,
      max_output_tokens: maxOutputTokens,
      // GPT-5.x reasoning tokens bill as output and count against max_output_tokens;
      // 'none' keeps the budget for the contract reply ('minimal' was dropped in gpt-5.6).
      reasoning: { effort: "none" },
    }, { signal: options.signal });

    return {
      text: response.output_text,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  },
};
