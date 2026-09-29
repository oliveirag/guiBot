// Saves raw lineup JSON for a few public profiles so the parser can be built against real data.
// Usage: node scripts/pp-probe.mjs [profileId...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiGet, connectPage, launchChrome } from './pp/chrome.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '.pp-out');
mkdirSync(out, { recursive: true });
const ids = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['go0QDE3G', 'VzYfrl6a'];
const port = 9334;

const chrome = await launchChrome({ port, profileDir: join(here, '.pp-chrome') });
try {
  const page = await connectPage(port);
  await page.goto(`https://app.prizepicks.com/p/${ids[0]}/open-lineups`, 9000);
  for (const id of ids) {
    for (const filter of ['pending']) {
      const t = Date.now();
      const { status, body } = await apiGet(page, `/v1/profiles/${id}/lineups?filter=${filter}`);
      writeFileSync(join(out, `${id}-${filter}.json`), body);
      let summary = body.slice(0, 120);
      try {
        const j = JSON.parse(body);
        summary = `data=${Array.isArray(j.data) ? j.data.length : typeof j.data} included=${j.included?.length ?? 0} types=${[...new Set((j.included ?? []).map((x) => x.type))].join(',')}`;
      } catch {}
      console.log(`${id} ${filter}: ${status} ${Date.now() - t}ms ${summary}`);
    }
  }
  for (const path of [`/profiles/${ids[0]}`, `/v1/profiles/${ids[0]}`]) {
    const { status, body } = await apiGet(page, path);
    console.log(path, status, body.slice(0, 600));
  }
  page.close();
} finally {
  chrome.kill();
}
