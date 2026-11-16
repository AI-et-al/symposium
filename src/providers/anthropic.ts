import Anthropic from "@anthropic-ai/sdk";
import type { ProviderAdapter } from "./types.js";

let client: Anthropic | undefined;

export const anthropicAdapter: ProviderAdapter = {
  provider: "anthropic",
  async complete(modelId, prompt, maxOutputTokens, options) {
    client ??= new Anthropic(); // lazy: the server must boot without keys

    // Keep the whole output budget for the contract: on Sonnet 5 / Opus 5 thinking is
    // on by default and counts against max_tokens. Haiku-class models predate the
    // disabled type and run thinking-off when the param is omitted.
    const thinking = modelId.includes("haiku") ? {} : { thinking: { type: "disabled" as const } };

    const response = await client.messages.create({
      model: modelId,
      max_tokens: maxOutputTokens,
      ...thinking,
      messages: [{ role: "user", content: prompt }],
    }, { signal: options.signal });

    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
    return {
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  },
};
