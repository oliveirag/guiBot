// PrizePicks watcher. Runs on Gui's Mac with a real Chrome window (PrizePicks blocks headless and
// server traffic), polls every profile guiBot tracks, and sends their open slips to guiBot.
// Usage: npm run pp:watch   Env (from .env): PP_WATCHER_TOKEN, GUIBOT_URL, PP_POLL_MS
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiGet, connectPage, launchChrome } from './pp/chrome.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(join(root, '.env'));
} catch {}

const TOKEN = process.env.PP_WATCHER_TOKEN?.trim();
const GUIBOT = (process.env.GUIBOT_URL?.trim() || 'https://guibot-production.up.railway.app').replace(/\/+$/, '');
const POLL_MS = Number(process.env.PP_POLL_MS) || 5000;
const PORT = 9335;
const PROFILES_EVERY_MS = 30_000;
const WARMUP_URL = 'https://app.prizepicks.com/p/go0QDE3G/open-lineups';

if (!TOKEN) {
  console.error('Set PP_WATCHER_TOKEN in .env (the same value as on Railway).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString();
const say = (...args) => console.log(stamp(), ...args);

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

async function run() {
  const chrome = await launchChrome({ port: PORT, profileDir: join(root, 'scripts', '.pp-chrome') });
  const page = await connectPage(PORT);
  const stop = () => {
    page.close();
    chrome.kill();
  };
  try {
    say('Opening PrizePicks in Chrome...');
    await page.goto(WARMUP_URL, 9000);

    const profiles = new Map(); // id -> { username, avatarUrl } once fetched
    let lastProfilesAt = 0;
    let blocked = 0;

    for (;;) {
      if (chrome.exitCode !== null) throw new Error('Chrome closed');
      if (Date.now() - lastProfilesAt > PROFILES_EVERY_MS) {
        const { profiles: ids } = await guibot('/pp/profiles');
        for (const id of ids) if (!profiles.has(id)) profiles.set(id, null);
        for (const id of profiles.keys()) if (!ids.includes(id)) profiles.delete(id);
        if (lastProfilesAt === 0) say(`Watching ${ids.length} profile${ids.length === 1 ? '' : 's'}: ${ids.join(', ') || 'none yet'}`);
        lastProfilesAt = Date.now();
      }

      const started = Date.now();
      for (const [id, known] of profiles) {
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
          blocked = 0;
          const result = await guibot('/pp/lineups', { profileId: id, profile: info ?? undefined, lineups: JSON.parse(res.body) });
          if (result.posted > 0) say(`${info?.username ?? id}: posted ${result.posted} new slip${result.posted === 1 ? '' : 's'}`);
          if (result.baselined > 0) say(`${info?.username ?? id}: first check, skipped ${result.baselined} open slip(s)`);
        } else if (res.status === 403 && res.body.includes('captcha')) {
          blocked++;
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
    stop();
  }
}

process.on('SIGINT', () => process.exit(0));
for (;;) {
  try {
    await run();
  } catch (error) {
    say(`Watcher error: ${error.message}. Restarting in 10s.`);
    await sleep(10_000);
  }
}
