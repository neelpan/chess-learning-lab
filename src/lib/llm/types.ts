// Provider-agnostic LLM interface. The app only ever talks to this.
export type LLMMessage = { role: "system" | "user" | "assistant"; content: string };

export type LLMRequest = {
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
};

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMRequest): Promise<string>;
}
