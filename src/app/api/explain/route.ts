import { getLLM } from "@/lib/llm";
import {
  cleanLLMText,
  explanationMatchesFacts,
  mistakeFallback,
  mistakePrompt,
  recapFallback,
  recapPrompt,
  type MistakeFacts,
  type RecapFacts,
} from "@/lib/teaching";
import type { PieceRef, TacticalFacts } from "@/lib/tactics/types";

// Never cached: depends on request body and a secret key.
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 12_000;

type Body =
  | { kind: "mistake"; facts: MistakeFacts }
  | { kind: "recap"; facts: RecapFacts };

const str = (v: unknown, max = 300): v is string => typeof v === "string" && v.length <= max;
const strArray = (v: unknown, maxLen = 10): v is string[] =>
  Array.isArray(v) && v.length <= maxLen && v.every((x) => str(x, 60));

const MOTIFS = [
  "fork",
  "pin",
  "skewer",
  "hanging_piece",
  "discovered_check",
  "discovered_attack",
  "remove_defender",
  "sacrifice",
];
const PIECES = ["pawn", "knight", "bishop", "rook", "queen", "king"];

function isPieceRef(p: unknown): boolean {
  const x = p as PieceRef;
  return (
    !!x &&
    PIECES.includes(x.piece) &&
    (x.color === "white" || x.color === "black") &&
    typeof x.square === "string" &&
    /^[a-h][1-8]$/.test(x.square)
  );
}

function isTacticalFacts(t: unknown): t is TacticalFacts {
  const x = t as TacticalFacts;
  return (
    !!x &&
    str(x.learnerMove, 12) &&
    str(x.opponentMove, 12) &&
    str(x.opponentMoveUci, 5) &&
    MOTIFS.includes(x.motif) &&
    ["created_by_move", "already_present", "unknown"].includes(x.relation) &&
    isPieceRef(x.attacker) &&
    Array.isArray(x.targets) &&
    x.targets.length <= 4 &&
    x.targets.every(isPieceRef) &&
    (x.revealedPiece === undefined || isPieceRef(x.revealedPiece)) &&
    strArray(x.followUp) &&
    typeof x.materialGain === "number" &&
    x.engineVerified === true &&
    typeof x.engineRank === "number" &&
    typeof x.centipawnLoss === "number" &&
    (x.sacrificedPiece === undefined || PIECES.includes(x.sacrificedPiece))
  );
}

function isMistakeFacts(f: unknown): f is MistakeFacts {
  const x = f as MistakeFacts;
  return (
    !!x &&
    str(x.playerColor, 10) &&
    str(x.playedSan, 12) &&
    str(x.bestSan, 12) &&
    str(x.playedEval, 10) &&
    str(x.bestEval, 10) &&
    strArray(x.refutationLine) &&
    strArray(x.bestLine) &&
    (x.materialLoss === undefined || (typeof x.materialLoss === "number" && x.materialLoss >= 0 && x.materialLoss <= 100)) &&
    (x.tactic === undefined || x.tactic === null || isTacticalFacts(x.tactic))
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
    const raw = await llm.complete({
      messages,
      maxTokens: body.kind === "mistake" ? 200 : 90,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = cleanLLMText(raw);
    // The model may only restate the supplied facts; anything else is discarded.
    if (body.kind === "mistake" && !explanationMatchesFacts(text, body.facts)) {
      console.error("[explain] LLM text rejected: mentions moves or squares outside the facts");
      return Response.json({ text: fallback(), source: "fallback" });
    }
    return Response.json({ text, source: "llm" });
  } catch (err) {
    // Log the failure type only — never the key or request headers.
    console.error("[explain] LLM call failed:", err instanceof Error ? err.message : "unknown");
    return Response.json({ text: fallback(), source: "fallback" });
  }
}
