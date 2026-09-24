// Deterministic chess evaluation: Stockfish (WASM, lite single-threaded) in a Web Worker.
// The LLM is never asked to evaluate positions — everything numeric comes from here.

import { SearchCollector, searchCommands, type Analysis } from "./uci";

export type { Analysis, EngineLine } from "./uci";

export type AnalyseOptions = {
  depth?: number;
  /** Number of principal variations to return (default 1). */
  multiPv?: number;
};

/** Anything that can analyse a position; implemented by the browser worker and the Node test engine. */
export interface AnalysisEngine {
  analyse(fen: string, options?: AnalyseOptions): Promise<Analysis>;
}

const ENGINE_URL = "/engine/stockfish-19-lite-single.js";

class Engine implements AnalysisEngine {
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
  analyse(fen: string, options: AnalyseOptions = {}): Promise<Analysis> {
    const run = () => this.search(fen, options.depth ?? 14, options.multiPv ?? 1);
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async search(fen: string, depth: number, multiPv: number): Promise<Analysis> {
    await this.ready;
    return new Promise((resolve, reject) => {
      const collector = new SearchCollector();
      const onError = () => {
        cleanup();
        reject(new Error("Chess engine crashed"));
      };
      const onMessage = (e: MessageEvent) => {
        const done = collector.feed(String(e.data));
        if (done) {
          cleanup();
          resolve(done);
        }
      };
      const cleanup = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
      };

      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      for (const command of searchCommands(fen, depth, multiPv)) this.worker.postMessage(command);
    });
  }
}

let instance: Engine | null = null;

/** Lazily creates the engine. Browser only. */
export function getEngine(): Engine {
  if (!instance) instance = new Engine();
  return instance;
}
