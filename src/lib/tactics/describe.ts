// Deterministic wording for verified tactical facts. Used as the fallback explanation and
// as a reference for what the LLM is allowed to say.
import { Chess } from "chess.js";
import { PIECE_NAMES, VALUE, other, pieces } from "./board";
import { parseUci } from "../chess-utils";
import type { PieceRef, TacticalFacts } from "./types";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const on = (p: PieceRef) => `${p.piece} on ${p.square}`;

/** "White Nxf7, Black Kxf7, White Qf3+": the engine line with the side that plays each move. */
export function sideLine(t: TacticalFacts, plies = 3): string {
  const first = t.attacker.color;
  const second = first === "white" ? "Black" : "White";
  return [t.opponentMove, ...t.followUp]
    .slice(0, plies)
    .map((move, i) => `${i % 2 === 0 ? cap(first) : second} ${move}`)
    .join(", ");
}

/** e.g. "White can play Ne5, attacking your queen on d7 and your rook on c6 at once — a knight fork." */
export function describeTactic(t: TacticalFacts): string {
  const who = cap(t.attacker.color);
  const move = t.opponentMove;
  const [a, b] = t.targets;
  switch (t.motif) {
    case "fork":
      return `${who} can play ${move}, attacking ${t.targets.map((x) => `your ${on(x)}`).join(" and ")} at once — a ${t.attacker.piece} fork.`;
    case "pin":
      return `${who} can play ${move}, pinning your ${on(a)} against your ${on(b)}.`;
    case "skewer":
      return `${who} can play ${move}, a skewer: your ${on(a)} has to move, and then your ${on(b)} can be captured.`;
    case "hanging_piece":
      return `${who} can play ${move}, winning your ${on(a)} — none of your pieces can take it back.`;
    case "discovered_check": {
      const rev = t.revealedPiece;
      const uncover = rev
        ? `moving the ${t.attacker.piece} uncovers the check from the ${on(rev)}`
        : `moving the ${t.attacker.piece} uncovers a check`;
      const loses = a && a.piece !== "king" ? ` While you deal with the check, your ${on(a)} can be captured.` : "";
      return `${who} can play ${move}, a discovered check: ${uncover}.${loses}`;
    }
    case "discovered_attack":
      return `${who} can play ${move}, uncovering an attack from the ${t.revealedPiece ? on(t.revealedPiece) : "piece behind it"} onto your ${on(a)}.`;
    case "remove_defender":
      return `${who} can play ${move}, capturing your ${a.piece} on ${a.square}, which was guarding your ${on(b)} — so that ${b.piece} can then be won.`;
    case "sacrifice":
      return `${who} can continue with ${move}, giving up ${t.sacrificedPiece ? `its ${t.sacrificedPiece}` : "material"} at first. Stockfish's line: ${sideLine(t)}, and it ends up better for ${who}.`;
  }
}

/** Full learner-facing sentence, with the relation to the learner's move made explicit. */
export function tacticExplanation(t: TacticalFacts): string {
  const body = describeTactic(t);
  return t.relation === "already_present"
    ? `${t.learnerMove} doesn't deal with a threat that was already there. ${body}`
    : `This move allows a tactical sequence. After ${t.learnerMove}, ${body}`;
}

/**
 * What a good move actually does, derived from the position: enemy pieces it newly attacks.
 * Returns null when it makes no direct threat.
 */
export function describeThreats(beforeFen: string, uci: string): string | null {
  try {
    const game = new Chess(beforeFen);
    const mover = game.turn();
    const { from, to, promotion } = parseUci(uci);
    const move = game.move({ from, to, promotion });
    const before = new Chess(beforeFen);
    const hit = pieces(game, other(mover))
      .filter((p) => p.type !== "k" && p.type !== "p" && VALUE[p.type] >= 3)
      .filter((p) => game.attackers(p.square, mover).includes(move.to))
      .filter((p) => !before.attackers(p.square, mover).includes(move.from));
    if (!hit.length) return null;
    const list = hit.map((p) => `the ${PIECE_NAMES[p.type]} on ${p.square}`).join(" and ");
    return `${move.san} attacks ${list}, so your opponent has to react to it.`;
  } catch {
    return null;
  }
}

/** Short label for badges, e.g. "Knight fork". */
export function motifLabel(t: TacticalFacts): string {
  switch (t.motif) {
    case "fork":
      return `${cap(t.attacker.piece)} fork`;
    case "pin":
      return "Pin";
    case "skewer":
      return "Skewer";
    case "hanging_piece":
      return "Hanging piece";
    case "discovered_check":
      return "Discovered check";
    case "discovered_attack":
      return "Discovered attack";
    case "remove_defender":
      return "Removing the defender";
    case "sacrifice":
      return "Sacrifice";
  }
}
