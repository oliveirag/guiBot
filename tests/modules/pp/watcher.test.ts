import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { launchAgentPlist } from '../../../scripts/pp/autostart.mjs';
import { closeChromeOnPort, connectPage } from '../../../scripts/pp/chrome.mjs';
import { supervise } from '../../../scripts/pp/supervise.mjs';
import { keepWatching } from '../../../scripts/pp/watcher.mjs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const noSleep = async () => {};

/** A stand-in for Chrome's DevTools endpoints: one tab that answers every call with "ok". */
async function fakeChrome() {
  const server: Server = createServer((req, res) => {
    const { port } = server.address() as AddressInfo;
    if (req.url === '/json/version') res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/browser` }));
    else res.end(JSON.stringify([{ type: 'page', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/page` }]));
  });
  const wss = new WebSocketServer({ server });
  const state = { answering: true, methods: [] as string[] };
  const shutdown = () =>
    new Promise<void>((resolve) => {
      for (const client of wss.clients) client.terminate();
      wss.close();
      server.closeAllConnections();
      server.close(() => resolve());
    });
  wss.on('connection', (sock) =>
    sock.on('message', (data) => {
      const msg = JSON.parse(String(data));
      state.methods.push(msg.method);
      if (msg.method === 'Browser.close') return void shutdown();
      if (state.answering) sock.send(JSON.stringify({ id: msg.id, result: { result: { value: 'ok' } } }));
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    state,
    /** The tab goes away, like a crashed renderer or the Mac waking from sleep. */
    dropTab: () => {
      for (const client of wss.clients) client.terminate();
    },
    shutdown,
  };
}

let chrome: Awaited<ReturnType<typeof fakeChrome>> | null = null;
afterEach(async () => {
  await chrome?.shutdown();
  chrome = null;
});

describe('connectPage', () => {
  it('rejects calls made after the tab closed instead of waiting forever (the 10/2 exit code 13)', async () => {
    chrome = await fakeChrome();
    const page = await connectPage(chrome.port);
    expect(await page.evaluate('1')).toBe('ok');
    chrome.dropTab();
    await sleep(50);
    expect(page.isOpen()).toBe(false);
    await expect(page.evaluate('1')).rejects.toThrow('Chrome closed');
  });

  it('rejects a call that is in flight when the tab closes', async () => {
    chrome = await fakeChrome();
    chrome.state.answering = false;
    const page = await connectPage(chrome.port);
    const call = page.evaluate('1');
    chrome.dropTab();
    await expect(call).rejects.toThrow('Chrome closed');
  });

  it('times out when Chrome stops answering', async () => {
    chrome = await fakeChrome();
    chrome.state.answering = false;
    const page = await connectPage(chrome.port, { timeoutMs: 100 });
    await expect(page.evaluate('1')).rejects.toThrow("Chrome didn't answer Runtime.evaluate");
    page.close();
  });
});

describe('setWindowState', () => {
  it('minimizes the window, and brings it to the front when shown', async () => {
    chrome = await fakeChrome();
    const page = await connectPage(chrome.port);
    await page.setWindowState('minimized');
    await page.setWindowState('normal');
    expect(chrome.state.methods).toEqual([
      'Browser.getWindowForTarget',
      'Browser.setWindowBounds',
      'Browser.getWindowForTarget',
      'Browser.setWindowBounds',
      'Page.bringToFront',
    ]);
    page.close();
  });
});

describe('launchAgentPlist', () => {
  it('runs the supervised watcher at login and restarts it only after a crash', () => {
    const plist = launchAgentPlist({ node: '/opt/homebrew/bin/node', root: '/Users/g/guiBot' });
    expect(plist).toContain('<string>/opt/homebrew/bin/node</string>\n    <string>/Users/g/guiBot/scripts/pp-watch.mjs</string>');
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(plist).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/);
    expect(plist).toContain('/Users/g/guiBot/scripts/.pp-watch.log');
    expect(plist).not.toContain('caffeinate');
  });

  it('keeps the Mac awake when asked, and escapes paths', () => {
    const plist = launchAgentPlist({ node: '/usr/local/bin/node', root: '/Users/g/R&D', stayAwake: true });
    expect(plist).toContain('<string>/usr/bin/caffeinate</string>\n    <string>-i</string>');
    expect(plist).toContain('/Users/g/R&amp;D/scripts/pp-watch.mjs');
  });
});

describe('closeChromeOnPort', () => {
  it('closes a Chrome left behind on the port', async () => {
    chrome = await fakeChrome();
    expect(await closeChromeOnPort(chrome.port)).toBe(true);
    expect(chrome.state.methods).toContain('Browser.close');
    chrome = null;
  });

  it('does nothing when the port is free', async () => {
    const free = await fakeChrome();
    await free.shutdown();
    expect(await closeChromeOnPort(free.port)).toBe(false);
  });
});

describe('keepWatching', () => {
  it('survives a Chrome disconnect by reconnecting and carrying on', async () => {
    chrome = await fakeChrome();
    const fake = chrome;
    const logs: string[] = [];
    let runs = 0;
    let polls = 0;
    await keepWatching(
      async ({ beat }) => {
        runs++;
        const page = await connectPage(fake.port);
        try {
          for (let round = 0; round < 5; round++) {
            beat();
            await page.evaluate('poll()');
            polls++;
            if (runs === 1 && round === 1) fake.dropTab();
            await sleep(20);
          }
        } finally {
          page.close();
        }
      },
      { say: (m) => logs.push(m), sleep: noSleep },
    );
    expect(runs).toBe(2);
    expect(polls).toBe(2 + 5);
    expect(logs.some((l) => l.startsWith('Watcher error: Error: Chrome closed'))).toBe(true);
    expect(logs).toContain('Restarting in 10s.');
  });

  it('aborts and restarts a run that stops making progress', async () => {
    const logs: string[] = [];
    let runs = 0;
    let firstAborted = false;
    await keepWatching(
      async ({ signal }) => {
        runs++;
        if (runs === 1) {
          signal.addEventListener('abort', () => (firstAborted = true));
          await new Promise(() => {}); // hangs, like awaiting a dead socket
        }
      },
      { say: (m) => logs.push(m), stallMs: 50, sleep: noSleep },
    );
    expect(runs).toBe(2);
    expect(firstAborted).toBe(true);
    expect(logs.some((l) => l.includes('made no progress'))).toBe(true);
  });

  it('stops after maxRuns failures', async () => {
    let runs = 0;
    await keepWatching(
      async () => {
        runs++;
        throw new Error('boom');
      },
      { say: () => {}, maxRuns: 3, sleep: noSleep },
    );
    expect(runs).toBe(3);
  });
});

describe('supervise', () => {
  // Exits with 13 the first time it runs and 0 the second time.
  const flaky = (dir: string) => [
    '-e',
    `const fs = require('node:fs'); const f = ${JSON.stringify(join(dir, 'ran'))};
     if (fs.existsSync(f)) process.exit(0); fs.writeFileSync(f, ''); process.exit(13);`,
  ];

  it('restarts the watcher process when it dies, and logs why', async () => {
    const logs: string[] = [];
    const delays: number[] = [];
    const starts = await supervise(process.execPath, flaky(mkdtempSync(join(tmpdir(), 'pp-'))), {
      say: (m) => logs.push(m),
      sleep: async (ms) => void delays.push(ms),
    });
    expect(starts).toBe(2);
    expect(logs).toEqual(['Watcher process exited with code 13. Restarting in 10s.']);
    expect(delays).toEqual([10_000]);
  });

  it("doesn't restart on a setup error", async () => {
    const logs: string[] = [];
    const starts = await supervise(process.execPath, ['-e', 'process.exit(2)'], { say: (m) => logs.push(m), stopCodes: [0, 2], sleep: noSleep });
    expect(starts).toBe(1);
    expect(logs).toEqual([]);
  });

  it('backs off while the process keeps crashing', async () => {
    const delays: number[] = [];
    let calls = 0;
    const dir = mkdtempSync(join(tmpdir(), 'pp-'));
    const crashThenOk = [
      '-e',
      `const fs = require('node:fs'); const f = ${JSON.stringify(join(dir, 'n'))};
       const n = fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0;
       fs.writeFileSync(f, String(n + 1)); process.exit(n < 3 ? 1 : 0);`,
    ];
    await supervise(process.execPath, crashThenOk, {
      say: () => calls++,
      retryMs: 100,
      maxRetryMs: 300,
      sleep: async (ms) => void delays.push(ms),
    });
    expect(calls).toBe(3);
    expect(delays).toEqual([100, 200, 300]);
  });
});
