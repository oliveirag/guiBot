const stamp = (): string => new Date().toISOString();

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export const log: Logger = {
  info: (...args) => console.log(stamp(), 'INFO', ...args),
  warn: (...args) => console.warn(stamp(), 'WARN', ...args),
  error: (...args) => console.error(stamp(), 'ERROR', ...args),
};
