// Restarts a child process whenever it dies, so one crash doesn't stop the PrizePicks watcher for good.
import { spawn } from 'node:child_process';

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// If the supervisor itself is stopped, take the watcher down with it.
let current = null;
process.once('exit', () => current?.kill());

/**
 * Runs `command args` until it exits with one of stopCodes or is stopped with Ctrl+C. Any other exit is
 * logged and restarted after retryMs, doubling up to maxRetryMs while it keeps crashing fast.
 * Resolves with the number of times the child was started.
 */
export async function supervise(command, args, { say, stopCodes = [0], retryMs = 10_000, maxRetryMs = 5 * 60_000, healthyMs = 10 * 60_000, sleep = defaultSleep } = {}) {
  let delay = retryMs;
  let starts = 0;
  for (;;) {
    starts++;
    const started = Date.now();
    const child = spawn(command, args, { stdio: 'inherit' });
    current = child;
    const { code, signal } = await new Promise((resolve) => {
      child.on('error', (error) => resolve({ code: null, signal: null, error }));
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });
    if (stopCodes.includes(code) || signal === 'SIGINT') return starts;
    if (Date.now() - started > healthyMs) delay = retryMs;
    say(`Watcher process ${signal ? `was killed by ${signal}` : `exited with code ${code}`}. Restarting in ${Math.round(delay / 1000)}s.`);
    await sleep(delay);
    delay = Math.min(delay * 2, maxRetryMs);
  }
}
