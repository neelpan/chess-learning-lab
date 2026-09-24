// Hand-authored teaching content. Everything the learner sees as "the lesson" lives here;
// engine numbers and LLM prose are layered on top of it, never the other way round.

export type Concept = {
  id: string;
  name: string;
  /** Short label for the kind of idea, e.g. "Opening" / "Tactical theme". */
  kind: string;
  idea: string;
  whyItMatters: string;
  /** Squares to highlight on the board when the concept surfaces. */
  focusSquares: string[];
};

export const CONCEPTS: Record<string, Concept> = {
  italian: {
    id: "italian",
    name: "Italian Game",
    kind: "Opening",
    idea: "Your bishop on c4 stares at f7 — Black's weakest square early on, guarded only by the king.",
    whyItMatters:
      "Openings are really plans. Once you recognise this one, you know what to build (more attackers on f7, a strong centre) and what the opponent must watch for. Naming the plan turns memorised moves into understanding.",
    focusSquares: ["c4", "f7"],
  },
  twoKnightsAttack: {
    id: "twoKnightsAttack",
    name: "Two attackers on f7",
    kind: "Tactical theme",
    idea: "Bishop and knight now both hit f7, and only the king defends it. Attackers outnumber defenders.",
    whyItMatters:
      "Counting attackers against defenders on a weak square is the fastest way to spot tactics — for you and against you. This exact setup is where many players get into trouble on the Black side.",
    focusSquares: ["c4", "g5", "f7"],
  },
  ruy: {
    id: "ruy",
    name: "Ruy Lopez",
    kind: "Opening",
    idea: "The bishop pins its pressure on the knight that defends e5, aiming at long-term central control rather than a quick strike.",
    whyItMatters:
      "Recognising a slow-burning plan tells you not to rush. You improve pieces, keep the tension, and let small advantages accumulate.",
    focusSquares: ["b5", "c6", "e5"],
  },
  scotch: {
    id: "scotch",
    name: "Scotch Game",
    kind: "Opening",
    idea: "You challenge the centre immediately, trading the d-pawn to open lines for your pieces.",
    whyItMatters:
      "Opening the centre rewards the better-developed side. Knowing that helps you decide when a pawn break is worth it — and when it isn't.",
    focusSquares: ["d4", "e5"],
  },
  tempo: {
    id: "tempo",
    name: "Gaining a tempo",
    kind: "Principle",
    idea: "A move that attacks an enemy piece forces a reply, so you improve your position while your opponent loses time.",
    whyItMatters:
      "Defending by counter-attacking keeps the initiative. It is often stronger than passively guarding what is under fire.",
    focusSquares: ["a5", "c4"],
  },
  development: {
    id: "development",
    name: "Development & the centre",
    kind: "Principle",
    idea: "This is off the well-trodden path, so fall back on fundamentals: develop pieces toward the centre, then castle.",
    whyItMatters:
      "Most beginner losses come from ignoring the basics rather than missing deep tactics. When theory runs out, principles carry you.",
    focusSquares: ["e4", "d4", "e5", "d5"],
  },
};

// ---------------------------------------------------------------------------
// PLAY: a predefined position where the learner picks the third move.
// ---------------------------------------------------------------------------

/** Moves already played before the learner takes over: 1.e4 e5 2.Nf3 Nc6 */
export const PLAY_SETUP_MOVES = ["e4", "e5", "Nf3", "Nc6"];

export const PLAY_SCENARIO = {
  title: "Choose your third move",
  intro:
    "You're White. Both sides have started with 1.e4 e5 2.Nf3 Nc6. Each natural developing move steers the game into a different opening — play the one you like and see what you've walked into.",
  suggestion: "Try developing a bishop or striking in the centre.",
};

/** Opening lines the learner might reach. Longest matching prefix wins. */
export const OPENING_LINES: { line: string[]; concept: string }[] = [
  { line: [...PLAY_SETUP_MOVES, "Bc4"], concept: "italian" },
  { line: [...PLAY_SETUP_MOVES, "Bc4", "Nf6", "Ng5"], concept: "twoKnightsAttack" },
  { line: [...PLAY_SETUP_MOVES, "Bb5"], concept: "ruy" },
  { line: [...PLAY_SETUP_MOVES, "d4"], concept: "scotch" },
];

/** Deterministic Black replies to the learner's third move (so the demo is reliable). */
export const SCRIPTED_REPLIES: Record<string, string> = {
  Bc4: "Nf6",
  Bb5: "a6",
  d4: "exd4",
};

export function recogniseConcept(sanHistory: string[]): Concept {
  let best: { line: string[]; concept: string } | null = null;
  for (const entry of OPENING_LINES) {
    const matches = entry.line.every((san, i) => sanHistory[i] === san);
    if (matches && (!best || entry.line.length > best.line.length)) best = entry;
  }
  return CONCEPTS[best ? best.concept : "development"];
}

// ---------------------------------------------------------------------------
// TRAINING: a predefined teaching position with one tempting mistake.
// ---------------------------------------------------------------------------

export const TRAINING = {
  id: "two-knights-f7",
  title: "Answer the attack on f7",
  /** Black to move after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 5.exd5 */
  fen: "r1bqkb1r/ppp2ppp/2n2n2/3Pp1N1/2B5/8/PPPP1PPP/RNBQK2R b KQkq - 0 5",
  playerColor: "black" as const,
  setup: "1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 5.exd5",
  prompt:
    "White's pawn on d5 now attacks your knight on c6. You're Black — what's the best way to respond?",
  hint: "Count the pieces attacking f7, then the pieces defending it.",
  weakSquare: "f7",
  theme: "the pressure on f7, where attackers outnumber defenders",
  focusSquares: ["c4", "g5", "f7"],
  /** Moves within this many centipawns of the best move count as good. */
  acceptableLoss: 40,
  principle: {
    title: "Deal with the threat before you grab material",
    body: "When a weak square is attacked more times than it is defended, that problem outranks any pawn you can win. Fix it first — ideally with a move that hits one of the attackers and gains a tempo.",
  },
  takeaway:
    "Before you grab a pawn, count the attackers on your weak squares — and hit an attacker first.",
  /** The line shown for a correct answer, used when the learner finds the top move. */
  whyBestWorks:
    "Na5 attacks the bishop on c4 — one of the two pieces bearing down on f7 — so White has to spend a move on it instead of piling on. After Bb5+ c6 you return the pawn, but you're solid and out of danger.",
  trap: {
    move: "Nxd5",
    label: "The Fried Liver trap",
    body: "Recapturing on d5 looks natural, but f7 is still attacked twice and defended once. White plays Nxf7! and your king is dragged into the open.",
  },
  concepts: ["twoKnightsAttack", "tempo"] as string[],
};
