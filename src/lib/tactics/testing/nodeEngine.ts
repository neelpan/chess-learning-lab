// Stockfish for Node tests: same binary and UCI parsing as the browser worker.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import type { AnalysisEngine, AnalyseOptions } from "../../engine";
import { SearchCollector, searchCommands, type Analysis } from "../../uci";

const BINARY = path.join(process.cwd(), "node_modules/stockfish/bin/stockfish-19-lite-single.js");

export class NodeEngine implements AnalysisEngine {
  private proc: ChildProcessWithoutNullStreams;
  private listeners = new Set<(line: string) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;

  constructor() {
    this.proc = spawn("node", [BINARY]);
    let buffer = "";
    this.proc.stdout.on("data", (chunk) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        this.listeners.forEach((l) => l(line));
      }
    });
    this.ready = new Promise((resolve) => {
      const onLine = (line: string) => {
        if (line === "uciok") {
          this.listeners.delete(onLine);
          resolve();
        }
      };
      this.listeners.add(onLine);
      this.proc.stdin.write("uci\n");
    });
  }

  analyse(fen: string, { depth = 14, multiPv = 1 }: AnalyseOptions = {}): Promise<Analysis> {
    const run = async () => {
      await this.ready;
      return new Promise<Analysis>((resolve) => {
        const collector = new SearchCollector();
        const onLine = (line: string) => {
          const done = collector.feed(line);
          if (done) {
            this.listeners.delete(onLine);
            resolve(done);
          }
        };
        this.listeners.add(onLine);
        for (const command of searchCommands(fen, depth, multiPv)) this.proc.stdin.write(command + "\n");
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  close() {
    this.proc.kill();
  }
}
