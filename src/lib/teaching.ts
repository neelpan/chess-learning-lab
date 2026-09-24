import { TRAINING } from "@/content/curriculum";
import type { LLMMessage } from "./llm/types";

// Facts computed deterministically (chess.js + Stockfish) and handed to the LLM.
// The LLM only turns them into language — it never picks or evaluates moves.

export type MistakeFacts = {
  theme: string;
  principle: string;
  playerColor: string;
  playedSan: string;
  bestSan: string;
  /** Evaluations in pawns from the learner's point of view, e.g. "-1.0". */
  playedEval: string;
  bestEval: string;
  /** The opponent's strongest reply to the move played, in SAN, plus the line after it. */
  refutationLine: string[];
  bestLine: string[];
};

export type RecapFacts = {
  concepts: string[];
  principle: string;
  mistake: { playedSan: string; bestSan: string } | null;
};

const SYSTEM = `You are a warm, precise chess coach writing for an improving club player.
Rules:
- Use ONLY the facts provided. Do not invent moves, variations or evaluations, and never analyse the position yourself.
- Refer to moves exactly as written in the facts.
- Plain text only: no markdown, no lists, no headings, no emoji.
- Be concrete and brief. No preamble like "Great question".`;

export function mistakePrompt(f: MistakeFacts): LLMMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `The learner plays ${f.playerColor}. Theme: ${f.theme}.
Move they played: ${f.playedSan} (engine evaluation for them: ${f.playedEval}).
Better move: ${f.bestSan} (evaluation: ${f.bestEval}).
Opponent's strongest reply to their move, then the continuation: ${f.refutationLine.join(" ") || "n/a"}.
Continuation after the better move: ${f.bestLine.join(" ") || "n/a"}.
Principle behind the mistake: ${f.principle}

In 2 to 3 sentences (max 70 words), explain why ${f.playedSan} is weaker than ${f.bestSan}. Point to the concrete consequence in the reply line, and tie it to the principle. Address the learner as "you".`,
    },
  ];
}

export function recapPrompt(f: RecapFacts): LLMMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Concepts the learner met: ${f.concepts.join("; ")}.
Principle to remember: ${f.principle}
${
  f.mistake
    ? `Their mistake: they played ${f.mistake.playedSan} where ${f.mistake.bestSan} was better.`
    : "They found the best move without a mistake."
}

Write ONE concise takeaway sentence (max 30 words) they can remember next time. Address the learner as "you".`,
    },
  ];
}

// ----- Deterministic fallbacks (used when there is no API key or the call fails) -----

export function mistakeFallback(f: MistakeFacts): string {
  const reply = f.refutationLine[0];
  const consequence = reply
    ? `The strongest reply, ${reply}, leaves you at ${f.playedEval}, compared with ${f.bestEval} after ${f.bestSan}.`
    : `The engine rates the position ${f.playedEval} after it, compared with ${f.bestEval} after ${f.bestSan}.`;
  return `${f.playedSan} is weaker because it ignores ${f.theme}. ${consequence}`;
}

export function recapFallback(): string {
  return TRAINING.takeaway;
}
