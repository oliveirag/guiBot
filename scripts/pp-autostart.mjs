// Starts the PrizePicks watcher at login, in the background, with Chrome minimized.
// Usage: npm run pp:autostart -- on [--stay-awake] | off | status
// Logs go to scripts/.pp-watch.log.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABEL, launchAgentPlist } from './pp/autostart.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const domain = `gui/${userInfo().uid}`;
const [command, ...flags] = process.argv.slice(2);

if (process.platform !== 'darwin') {
  console.error('Autostart only works on macOS.');
  process.exit(1);
}

const launchctl = (...args) => {
  try {
    return execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};
const unload = () => launchctl('bootout', `${domain}/${LABEL}`);

if (command === 'on') {
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, launchAgentPlist({ node: process.execPath, root, stayAwake: flags.includes('--stay-awake') }));
  unload();
  if (launchctl('bootstrap', domain, plistPath) === null) {
    console.error(`Couldn't load ${plistPath}. Try: launchctl bootstrap ${domain} ${plistPath}`);
    process.exit(1);
  }
  console.log('The watcher now runs in the background and starts at every login. Logs: scripts/.pp-watch.log');
  console.log('If you had `npm run pp:watch` open in a terminal, stop it so only one watcher runs.');
} else if (command === 'off') {
  unload();
  if (existsSync(plistPath)) unlinkSync(plistPath);
  console.log('Autostart is off and the background watcher is stopped.');
} else if (command === 'status') {
  console.log(launchctl('print', `${domain}/${LABEL}`) === null ? 'Autostart is off.' : 'Autostart is on. Logs: scripts/.pp-watch.log');
} else {
  console.error('Usage: npm run pp:autostart -- on [--stay-awake] | off | status');
  process.exit(1);
}
