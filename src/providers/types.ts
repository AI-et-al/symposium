import type { Provider } from "../router.js";

export interface CompletionUsage {
  inputTokens: number;
  /** Includes provider-side reasoning/thinking tokens where reported — they bill as output. */
  outputTokens: number;
}

export interface Completion {
  text: string;
  usage: CompletionUsage;
}

export interface CompleteOptions {
  /** Ask the provider for JSON output where it has a native switch (Gemini's responseMimeType). */
  json: boolean;
  /**
   * Aborted when the council's own timeout fires, so a call the council has given up on
   * stops running (and billing) instead of finishing unrecorded in the background.
   */
  signal?: AbortSignal;
}

/** One provider = one advisor voice. Thin completion wrapper; all contract logic lives in council.ts. */
export interface ProviderAdapter {
  provider: Provider;
  complete(
    modelId: string,
    prompt: string,
    maxOutputTokens: number,
    options: CompleteOptions,
  ): Promise<Completion>;
}
