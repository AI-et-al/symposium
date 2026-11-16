import OpenAI from "openai";
import type { ProviderAdapter } from "./types.js";

let client: OpenAI | undefined;

/** DeepSeek is OpenAI-compatible: same SDK, chat-completions endpoint, DeepSeek base URL. */
export const deepseekAdapter: ProviderAdapter = {
  provider: "deepseek",
  async complete(modelId, prompt, maxOutputTokens, options) {
    client ??= new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com",
    });

    const response = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      // DeepSeek's compat layer documents max_tokens (not the newer max_completion_tokens).
      max_tokens: maxOutputTokens,
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
