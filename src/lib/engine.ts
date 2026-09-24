// Deterministic chess evaluation: Stockfish (WASM, lite single-threaded) in a Web Worker.
// The LLM is never asked to evaluate positions — everything numeric comes from here.

export type Analysis = {
  /** Centipawns from the side-to-move's perspective (mate scores are clamped). */
  cp: number;
  /** Moves to mate (positive = side to move mates), or null. */
  mate: number | null;
  bestMove: string;
  /** Principal variation in UCI notation. */
  pv: string[];
};

type AnalyseOptions = { depth?: number };

const ENGINE_URL = "/engine/stockfish-19-lite-single.js";
const MATE_CP = 1000;

class Engine {
  private worker: Worker;
  private ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.ready = this.handshake();
  }

  private handshake(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = () => reject(new Error("Chess engine failed to load"));
      this.worker.addEventListener("error", onError, { once: true });
      const onMessage = (e: MessageEvent) => {
        const line = String(e.data);
        if (line === "uciok") {
          this.worker.postMessage("setoption name Threads value 1");
          this.worker.postMessage("setoption name Hash value 16");
          this.worker.postMessage("isready");
        } else if (line === "readyok") {
          this.worker.removeEventListener("message", onMessage);
          this.worker.removeEventListener("error", onError);
          resolve();
        }
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage("uci");
    });
  }

  /** Analyses run one at a time; the engine has a single search state. */
  analyse(fen: string, { depth = 14 }: AnalyseOptions = {}): Promise<Analysis> {
    const run = () => this.search(fen, depth);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async search(fen: string, depth: number): Promise<Analysis> {
    await this.ready;
    return new Promise((resolve, reject) => {
      let cp = 0;
      let mate: number | null = null;
      let pv: string[] = [];

      const onError = () => {
        cleanup();
        reject(new Error("Chess engine crashed"));
      };
      const onMessage = (e: MessageEvent) => {
        const line = String(e.data);
        if (line.startsWith("info") && line.includes(" score ") && line.includes(" pv ")) {
          const score = line.match(/score (cp|mate) (-?\d+)/);
          if (score) {
            if (score[1] === "cp") {
              cp = Number(score[2]);
              mate = null;
            } else {
              mate = Number(score[2]);
              cp = Math.sign(mate) * MATE_CP;
            }
          }
          pv = line.split(" pv ")[1].trim().split(/\s+/);
        } else if (line.startsWith("bestmove")) {
          cleanup();
          const bestMove = line.split(/\s+/)[1];
          resolve({ cp: clamp(cp), mate, bestMove, pv: pv.length ? pv : [bestMove] });
        }
      };
      const cleanup = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
      };

      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      // Clear the hash so identical positions always give identical evaluations.
      this.worker.postMessage("ucinewgame");
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }
}

function clamp(cp: number) {
  return Math.max(-MATE_CP, Math.min(MATE_CP, cp));
}

let instance: Engine | null = null;

/** Lazily creates the engine. Browser only. */
export function getEngine(): Engine {
  if (!instance) instance = new Engine();
  return instance;
}
