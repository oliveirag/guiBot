// Keeps the PrizePicks watcher going: restarts a run that throws, and stops a run that hangs.
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const describe = (error) => (error instanceof Error ? (error.stack ?? error.message) : String(error));

/**
 * Calls run() until it finishes. A run that throws is logged and restarted after retryMs.
 * A run that doesn't call beat() for stallMs is aborted (its signal fires, so it can close
 * Chrome) and restarted. The watchdog timer also keeps Node from ever exiting with code 13.
 *
 * @param {(ctx: { beat: () => void, signal: AbortSignal }) => Promise<unknown>} run
 */
export async function keepWatching(run, { say, retryMs = 10_000, stallMs = 5 * 60_000, maxRuns = Infinity, sleep = defaultSleep } = {}) {
  for (let n = 1; n <= maxRuns; n++) {
    const controller = new AbortController();
    let lastBeat = Date.now();
    let watchdog;
    const stalled = new Promise((_, reject) => {
      watchdog = setInterval(
        () => {
          if (Date.now() - lastBeat < stallMs) return;
          const error = new Error(`Watcher made no progress for ${Math.round(stallMs / 1000)}s`);
          controller.abort(error);
          reject(error);
        },
        Math.min(stallMs, 30_000),
      );
    });
    try {
      await Promise.race([run({ beat: () => (lastBeat = Date.now()), signal: controller.signal }), stalled]);
      return;
    } catch (error) {
      controller.abort(error);
      say(`Watcher error: ${describe(error)}`);
      if (n < maxRuns) {
        say(`Restarting in ${retryMs / 1000}s.`);
        await sleep(retryMs);
      }
    } finally {
      clearInterval(watchdog);
    }
  }
}

/** Logs anything that would kill the process, so a crash never goes silent again. */
export function logFatalErrors(say, onExit = () => {}) {
  process.on('uncaughtException', (error) => {
    say(`Fatal error: ${describe(error)}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (error) => {
    say(`Fatal unhandled rejection: ${describe(error)}`);
    process.exit(1);
  });
  process.on('exit', (code) => {
    onExit();
    if (code === 13) say('Watcher exited with code 13: it was waiting on something that can never finish.');
    else if (code !== 0) say(`Watcher exited with code ${code}.`);
  });
}
