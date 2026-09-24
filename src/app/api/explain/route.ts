import { getLLM } from "@/lib/llm";
import {
  mistakeFallback,
  mistakePrompt,
  recapFallback,
  recapPrompt,
  type MistakeFacts,
  type RecapFacts,
} from "@/lib/teaching";

// Never cached: depends on request body and a secret key.
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 12_000;

type Body =
  | { kind: "mistake"; facts: MistakeFacts }
  | { kind: "recap"; facts: RecapFacts };

const str = (v: unknown, max = 300): v is string => typeof v === "string" && v.length <= max;
const strArray = (v: unknown, maxLen = 10): v is string[] =>
  Array.isArray(v) && v.length <= maxLen && v.every((x) => str(x, 60));

function isMistakeFacts(f: unknown): f is MistakeFacts {
  const x = f as MistakeFacts;
  return (
    !!x &&
    str(x.theme) &&
    str(x.principle, 500) &&
    str(x.playerColor, 10) &&
    str(x.playedSan, 12) &&
    str(x.bestSan, 12) &&
    str(x.playedEval, 10) &&
    str(x.bestEval, 10) &&
    strArray(x.refutationLine) &&
    strArray(x.bestLine)
  );
}

function isRecapFacts(f: unknown): f is RecapFacts {
  const x = f as RecapFacts;
  return (
    !!x &&
    strArray(x.concepts) &&
    str(x.principle, 500) &&
    (x.mistake === null || (!!x.mistake && str(x.mistake.playedSan, 12) && str(x.mistake.bestSan, 12)))
  );
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const valid =
    (body?.kind === "mistake" && isMistakeFacts(body.facts)) ||
    (body?.kind === "recap" && isRecapFacts(body.facts));
  if (!valid) return Response.json({ error: "Invalid request" }, { status: 400 });

  const fallback = () =>
    body.kind === "mistake" ? mistakeFallback(body.facts) : recapFallback();

  const llm = getLLM();
  if (!llm) return Response.json({ text: fallback(), source: "fallback" });

  try {
    const messages = body.kind === "mistake" ? mistakePrompt(body.facts) : recapPrompt(body.facts);
    const text = await llm.complete({
      messages,
      maxTokens: body.kind === "mistake" ? 200 : 90,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return Response.json({ text, source: "llm" });
  } catch (err) {
    // Log the failure type only — never the key or request headers.
    console.error("[explain] LLM call failed:", err instanceof Error ? err.message : "unknown");
    return Response.json({ text: fallback(), source: "fallback" });
  }
}
