import { MistralProvider } from "./mistral";
import type { LLMProvider } from "./types";

export type { LLMProvider, LLMMessage, LLMRequest } from "./types";

/**
 * Returns the configured provider, or null when no key is set (callers then use
 * deterministic fallback copy). To swap models, change env vars; to add a new
 * vendor, implement LLMProvider and add a case here.
 */
export function getLLM(): LLMProvider | null {
  const provider = process.env.LLM_PROVIDER ?? "mistral";
  switch (provider) {
    case "mistral": {
      const key = process.env.MISTRAL_API_KEY;
      if (!key) return null;
      return new MistralProvider(key, process.env.MISTRAL_MODEL || undefined);
    }
    default:
      return null;
  }
}
