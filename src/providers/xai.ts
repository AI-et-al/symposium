import OpenAI from "openai";
import type { ProviderAdapter } from "./types.js";

let client: OpenAI | undefined;

/** xAI is OpenAI-compatible: same SDK, chat-completions endpoint, xAI base URL. */
export const xaiAdapter: ProviderAdapter = {
  provider: "xai",
  async complete(modelId, prompt, maxOutputTokens, options) {
    client ??= new OpenAI({
      apiKey: process.env.XAI_API_KEY,
      baseURL: "https://api.x.ai/v1",
    });

    const response = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: maxOutputTokens,
    }, { signal: options.signal });

    return {
      text: response.choices[0]?.message?.content ?? "",
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  },
};
