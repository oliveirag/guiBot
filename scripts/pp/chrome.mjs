// A real Google Chrome window driven over the DevTools protocol. No Playwright or Puppeteer:
// those launch Chrome with automation flags, which PrizePicks' bot protection blocks.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portOpen(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/**
 * Closes a Chrome left on the debugging port by a watcher that died without cleaning up.
 * Otherwise the new Chrome hands its window to the old one and exits at once, and the watcher
 * thinks Chrome closed on every round.
 */
export async function closeChromeOnPort(port) {
  const version = await portOpen(port);
  if (!version) return false;
  try {
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  } catch {}
  for (let i = 0; i < 40; i++) {
    if (!(await portOpen(port))) return true;
    await sleep(250);
  }
  throw new Error(`An old Chrome is still holding debugging port ${port}. Quit it and try again.`);
}

export async function launchChrome({ port, profileDir }) {
  mkdirSync(profileDir, { recursive: true });
  await closeChromeOnPort(port);
  const proc = spawn(
    CHROME,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i++) {
    if (await portOpen(port)) return proc;
    await sleep(250);
  }
  proc.kill();
  throw new Error(`Chrome didn't open its debugging port ${port}`);
}

/** Connects to the first open tab. */
export async function connectPage(port, { timeoutMs = 60_000 } = {}) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(10_000) })).json();
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('No Chrome tab to drive');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Chrome's DevTools socket didn't open in 10s"));
    }, 10_000);
    ws.addEventListener('open', () => (clearTimeout(timer), resolve()), { once: true });
    ws.addEventListener('error', () => (clearTimeout(timer), reject(new Error('DevTools socket failed'))), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const waiter = msg.id !== undefined && pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result);
  });
  ws.addEventListener('close', () => {
    for (const w of pending.values()) w.reject(new Error('Chrome closed'));
    pending.clear();
  });
  // A closed socket swallows sends silently. Without the open check and the timeout, a tab that
  // closes between rounds leaves the watcher awaiting a reply that never comes, and Node exits
  // with code 13 ("unsettled top-level await") instead of restarting. That's what happened on 10/2.
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      if (ws.readyState !== WebSocket.OPEN) return reject(new Error('Chrome closed'));
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Chrome didn't answer ${method} in ${timeoutMs / 1000}s`));
      }, timeoutMs);
      const done = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };
      pending.set(id, { resolve: done(resolve), reject: done(reject) });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        pending.delete(id);
        done(reject)(error);
      }
    });

  return {
    async goto(url, settleMs = 8000) {
      await send('Page.navigate', { url });
      await sleep(settleMs);
    },
    /** Runs an async expression in the page and returns its JSON-able value. */
    async evaluate(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    },
    /** Minimizes ('minimized') or shows ('normal') this tab's Chrome window. */
    async setWindowState(windowState) {
      const { windowId } = await send('Browser.getWindowForTarget');
      await send('Browser.setWindowBounds', { windowId, bounds: { windowState } });
      if (windowState === 'normal') await send('Page.bringToFront');
    },
    isOpen: () => ws.readyState === WebSocket.OPEN,
    close: () => ws.close(),
  };
}

/** GETs a PrizePicks API path from inside the page, so it carries the page's cookies like the site's own requests do. */
export function apiGet(page, path) {
  return page.evaluate(`(async () => {
    const r = await fetch('https://api.prizepicks.com${path}', { credentials: 'include', headers: { accept: 'application/json' } });
    return { status: r.status, body: await r.text() };
  })()`);
}
