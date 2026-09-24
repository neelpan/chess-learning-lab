"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Attempt = {
  id: number;
  san: string;
  bestSan: string;
  playedEval: string;
  bestEval: string;
  verdict: "best" | "good" | "inferior";
  refutationSan: string | null;
  explanation: string | null;
};

type SessionState = {
  /** Concept ids the learner has met, in order. */
  concepts: string[];
  attempts: Attempt[];
  solved: boolean;
  usedReveal: boolean;
  /** The tempting mistake for this position, explained by the same engine pipeline. */
  trap: { san: string; text: string } | null;
};

type SessionApi = SessionState & {
  addConcept: (id: string) => void;
  addAttempt: (attempt: Omit<Attempt, "id">) => number;
  updateAttempt: (id: number, patch: Partial<Attempt>) => void;
  markSolved: () => void;
  markRevealed: () => void;
  setTrap: (trap: { san: string; text: string }) => void;
  resetTraining: () => void;
  resetAll: () => void;
};

const EMPTY: SessionState = {
  concepts: [],
  attempts: [],
  solved: false,
  usedReveal: false,
  trap: null,
};
const SessionContext = createContext<SessionApi | null>(null);

// Learning state lives in memory only — no accounts, no storage.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(EMPTY);
  const nextId = useRef(1);

  const addConcept = useCallback((id: string) => {
    setState((s) => (s.concepts.includes(id) ? s : { ...s, concepts: [...s.concepts, id] }));
  }, []);

  const addAttempt = useCallback((attempt: Omit<Attempt, "id">) => {
    const id = nextId.current++;
    setState((s) => ({ ...s, attempts: [...s.attempts, { ...attempt, id }] }));
    return id;
  }, []);

  const updateAttempt = useCallback((id: number, patch: Partial<Attempt>) => {
    setState((s) => ({
      ...s,
      attempts: s.attempts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }));
  }, []);

  const markSolved = useCallback(() => setState((s) => ({ ...s, solved: true })), []);
  const markRevealed = useCallback(() => setState((s) => ({ ...s, usedReveal: true })), []);
  const resetTraining = useCallback(
    () => setState((s) => ({ ...s, attempts: [], solved: false, usedReveal: false, trap: null })),
    [],
  );
  const setTrap = useCallback((trap: { san: string; text: string }) => setState((s) => ({ ...s, trap })), []);
  const resetAll = useCallback(() => setState(EMPTY), []);

  const api = useMemo<SessionApi>(
    () => ({
      ...state,
      addConcept,
      addAttempt,
      updateAttempt,
      markSolved,
      markRevealed,
      setTrap,
      resetTraining,
      resetAll,
    }),
    [state, addConcept, addAttempt, updateAttempt, markSolved, markRevealed, setTrap, resetTraining, resetAll],
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
