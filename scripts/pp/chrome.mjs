// A real Google Chrome window driven over the DevTools protocol. No Playwright or Puppeteer:
// those launch Chrome with automation flags, which PrizePicks' bot protection blocks.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchChrome({ port, profileDir }) {
  mkdirSync(profileDir, { recursive: true });
  const proc = spawn(
    CHROME,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return proc;
    } catch {}
    await sleep(250);
  }
  proc.kill();
  throw new Error(`Chrome didn't open its debugging port ${port}`);
}

/** Connects to the first open tab. */
export async function connectPage(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('No Chrome tab to drive');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('DevTools socket failed')), { once: true });
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
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
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
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
