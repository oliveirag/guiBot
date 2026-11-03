export interface SuperviseOptions {
  say: (message: string) => void;
  stopCodes?: number[];
  retryMs?: number;
  maxRetryMs?: number;
  healthyMs?: number;
  sleep?: (ms: number) => Promise<void>;
}
export function supervise(command: string, args: string[], options: SuperviseOptions): Promise<number>;
