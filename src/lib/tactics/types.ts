export type Motif =
  | "fork"
  | "pin"
  | "skewer"
  | "hanging_piece"
  | "discovered_check"
  | "discovered_attack"
  | "remove_defender"
  | "sacrifice";

export type PieceName = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

export type PieceRef = {
  piece: PieceName;
  color: "white" | "black";
  square: string;
};

/**
 * Whether the tactic exists because of the learner's move, or was already available
 * (and the learner's move simply failed to deal with it).
 */
export type Relation = "created_by_move" | "already_present" | "unknown";

/** Structured, deterministic facts about a verified tactical consequence. Safe to hand to an LLM. */
export type TacticalFacts = {
  learnerMove: string;
  opponentMove: string;
  opponentMoveUci: string;
  motif: Motif;
  relation: Relation;
  /** The opponent piece that makes the tactical move (on its landing square). */
  attacker: PieceRef;
  /** The learner's pieces the tactic hits, most important first. */
  targets: PieceRef[];
  /** For discovered attacks: the piece whose line was uncovered. */
  revealedPiece?: PieceRef;
  /** Engine continuation after the opponent's move, in SAN. */
  followUp: string[];
  /** Material the opponent gains along the engine line, in pawns (negative for sacrifices). */
  materialGain: number;
  /** For sacrifices: the piece the opponent gives up (captured on the landing square by the reply). */
  sacrificedPiece?: PieceName;
  engineVerified: true;
  /** 1 = Stockfish's top reply to the learner's move. */
  engineRank: number;
  /** How much worse the learner's move is than their best move, in centipawns. */
  centipawnLoss: number;
};
