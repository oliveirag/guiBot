// PrizePicks watcher process. Runs on Gui's Mac with a real Chrome window (PrizePicks blocks headless
// and server traffic), polls every profile guiBot tracks, and sends their open slips to guiBot.
// Started and restarted by scripts/pp-watch.mjs. Run it directly to skip the supervisor.
// Usage: node scripts/pp/run.mjs [--url http://localhost:3000] [--rounds N]
// Env (from .env): PP_WATCHER_TOKEN, GUIBOT_URL, PP_POLL_MS, PP_SHOW_CHROME=1 to keep the window up
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { apiGet, connectPage, launchChrome } from './chrome.mjs';
import { keepWatching, logFatalErrors } from './watcher.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  process.loadEnvFile(join(root, '.env'));
} catch {}

const { values: args } = parseArgs({ options: { url: { type: 'string' }, rounds: { type: 'string' } } });
const TOKEN = process.env.PP_WATCHER_TOKEN?.trim();
const GUIBOT = (args.url || process.env.GUIBOT_URL?.trim() || 'https://guibot-production.up.railway.app').replace(/\/+$/, '');
// For testing: stop after this many polling rounds.
const ROUNDS = Number(args.rounds) || Infinity;
const POLL_MS = Number(process.env.PP_POLL_MS) || 5000;
const PORT = 9335;
const PROFILES_EVERY_MS = 30_000;
// Chrome sits minimized in the Dock and only comes up when PrizePicks wants a captcha.
const SHOW_CHROME = process.env.PP_SHOW_CHROME === '1';
const WARMUP_URL = 'https://app.prizepicks.com/p/go0QDE3G/open-lineups';
/** Exit code for setup mistakes, so the supervisor doesn't restart into the same error. */
const CONFIG_ERROR = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString();
const say = (...args) => console.log(stamp(), ...args);

if (!TOKEN) {
  console.error('Set PP_WATCHER_TOKEN in .env (the same value as on Railway).');
  process.exit(CONFIG_ERROR);
}

/** A macOS notification, so a captcha doesn't sit unnoticed behind a minimized window. */
function notify(message) {
  if (process.platform !== 'darwin') return;
  execFile('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "guiBot PrizePicks"`], () => {});
}

async function setWindow(page, state) {
  if (SHOW_CHROME) return;
  try {
    await page.setWindowState(state);
  } catch (error) {
    say(`Couldn't ${state === 'minimized' ? 'minimize' : 'show'} Chrome: ${error.message}`);
  }
}

async function guibot(path, body) {
  const res = await fetch(`${GUIBOT}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`guiBot ${path} ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// Chrome is our child, so it would outlive a crash. Close it whenever this process exits.
let currentChrome = null;
logFatalErrors(say, () => currentChrome?.kill());

async function run({ beat, signal }) {
  const chrome = await launchChrome({ port: PORT, profileDir: join(root, 'scripts', '.pp-chrome') });
  currentChrome = chrome;
  let page;
  try {
    page = await connectPage(PORT);
  } catch (error) {
    chrome.kill();
    throw error;
  }
  const stop = () => {
    page.close();
    chrome.kill();
  };
  // A stalled run is aborted by keepWatching. Closing Chrome makes its pending calls fail.
  signal.addEventListener('abort', stop, { once: true });
  try {
    say('Opening PrizePicks in Chrome...');
    await page.goto(WARMUP_URL, 9000);
    await setWindow(page, 'minimized');

    const profiles = new Map(); // id -> { username, avatarUrl } once fetched
    let lastProfilesAt = 0;
    let blocked = 0;

    for (let round = 0; round < ROUNDS; round++) {
      beat();
      if (signal.aborted || chrome.exitCode !== null || !page.isOpen()) throw new Error('Chrome closed');
      if (Date.now() - lastProfilesAt > PROFILES_EVERY_MS) {
        const { profiles: ids } = await guibot('/pp/profiles');
        for (const id of ids) if (!profiles.has(id)) profiles.set(id, null);
        for (const id of profiles.keys()) if (!ids.includes(id)) profiles.delete(id);
        if (lastProfilesAt === 0) say(`Watching ${ids.length} profile${ids.length === 1 ? '' : 's'}: ${ids.join(', ') || 'none yet'}`);
        lastProfilesAt = Date.now();
      }

      const started = Date.now();
      for (const [id, known] of profiles) {
        beat();
        let info = known;
        if (!info) {
          const res = await apiGet(page, `/profiles/${id}`);
          if (res.status === 200) {
            const p = JSON.parse(res.body);
            info = { username: p.username ?? null, avatarUrl: p.avatar_url ?? null };
            profiles.set(id, info);
          }
        }
        const res = await apiGet(page, `/v1/profiles/${id}/lineups?filter=pending`);
        if (res.status === 200) {
          if (blocked > 0) {
            say('Captcha cleared.');
            await setWindow(page, 'minimized');
          }
          blocked = 0;
          const result = await guibot('/pp/lineups', { profileId: id, profile: info ?? undefined, lineups: JSON.parse(res.body) });
          if (result.posted > 0) say(`${info?.username ?? id}: posted ${result.posted} new slip${result.posted === 1 ? '' : 's'}`);
          if (result.baselined > 0) say(`${info?.username ?? id}: first check, skipped ${result.baselined} open slip(s)`);
        } else if (res.status === 403 && res.body.includes('captcha')) {
          blocked++;
          if (blocked === 1) {
            notify('PrizePicks wants a captcha. Solve it in the Chrome window.');
            await setWindow(page, 'normal');
          }
          say(`PrizePicks wants a captcha. If one shows in the Chrome window, solve it. Reloading (${blocked})...`);
          await page.goto(WARMUP_URL, 9000);
          await sleep(Math.min(blocked * 15_000, 120_000));
          break;
        } else if (res.status === 403) {
          say(`${id}: profile is private, so its slips can't be read.`);
        } else {
          say(`${id}: PrizePicks answered ${res.status}`);
        }
      }
      await sleep(Math.max(0, POLL_MS - (Date.now() - started)));
    }
  } finally {
    signal.removeEventListener('abort', stop);
    stop();
  }
}

// Exit through process.exit so the exit hook closes Chrome (launchd stops us with SIGTERM).
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
say(`Sending slips to ${GUIBOT}`);
await keepWatching(run, { say });
