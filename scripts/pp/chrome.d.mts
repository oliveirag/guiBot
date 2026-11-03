import type { ChildProcess } from 'node:child_process';

export interface Page {
  goto(url: string, settleMs?: number): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  isOpen(): boolean;
  close(): void;
}
export function closeChromeOnPort(port: number): Promise<boolean>;
export function launchChrome(options: { port: number; profileDir: string }): Promise<ChildProcess>;
export function connectPage(port: number, options?: { timeoutMs?: number }): Promise<Page>;
export function apiGet(page: Page, path: string): Promise<{ status: number; body: string }>;
