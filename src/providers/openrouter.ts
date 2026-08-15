import OpenAI from "openai";
import type { ProviderAdapter } from "./types.js";

let client: OpenAI | undefined;

/** OpenRouter is OpenAI-compatible: same SDK, chat-completions endpoint, OpenRouter base URL. */
export const openrouterAdapter: ProviderAdapter = {
  provider: "openrouter",
  async complete(modelId, prompt, maxOutputTokens, _options) {
    client ??= new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const response = await client.chat.completions.create({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxOutputTokens,
      // OpenRouter's unified reasoning switch. Qwen ships hybrid reasoners; thinking
      // tokens bill as output and would eat the JSON contract's budget (P4 gate).
      // Models without a reasoning mode ignore the parameter.
      reasoning: { enabled: false },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

    return {
      text: response.choices[0]?.message?.content ?? "",
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        // OpenRouter folds any reasoning tokens into completion_tokens.
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  },
};
