import type { LLMProvider, LLMRequest } from "./types";

const ENDPOINT = "https://api.mistral.ai/v1/chat/completions";
export const DEFAULT_MISTRAL_MODEL = "ministral-3b-2512";

export class MistralProvider implements LLMProvider {
  readonly name = "mistral";

  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MISTRAL_MODEL,
  ) {}

  async complete({ messages, maxTokens = 220, temperature = 0.3, signal }: LLMRequest) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Mistral request failed (${res.status})`);

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    // Content is a string, or (for some models) an array of text chunks.
    const text = Array.isArray(content)
      ? content.map((c: { text?: string }) => c.text ?? "").join("")
      : content;
    if (typeof text !== "string" || !text.trim()) throw new Error("Empty response from Mistral");
    return text.trim();
  }
}
