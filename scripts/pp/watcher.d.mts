export interface WatchOptions {
  say: (message: string) => void;
  retryMs?: number;
  stallMs?: number;
  maxRuns?: number;
  sleep?: (ms: number) => Promise<void>;
}
export function keepWatching(run: (ctx: { beat: () => void; signal: AbortSignal }) => Promise<unknown>, options: WatchOptions): Promise<void>;
export function logFatalErrors(say: (message: string) => void, onExit?: () => void): void;
