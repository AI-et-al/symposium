import { GoogleGenAI } from "@google/genai";
import type { ProviderAdapter } from "./types.js";

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
        // Native JSON mode for the advisor contract; synthesis wants markdown.
        ...(options.json ? { responseMimeType: "application/json" } : {}),
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
