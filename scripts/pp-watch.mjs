// PrizePicks watcher. Runs on Gui's Mac with a real Chrome window and restarts the watcher
// process (scripts/pp/run.mjs) if it ever dies, logging why.
// Usage: npm run pp:watch [-- --url http://localhost:3000] [--rounds N]
// Env (from .env): PP_WATCHER_TOKEN, GUIBOT_URL, PP_POLL_MS
import { fileURLToPath } from 'node:url';
import { supervise } from './pp/supervise.mjs';

const say = (...args) => console.log(new Date().toLocaleTimeString(), ...args);
const worker = fileURLToPath(new URL('./pp/run.mjs', import.meta.url));

// Ctrl+C reaches the watcher too. It exits cleanly, and then so do we.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => process.exit(0));
// 2 is the watcher's setup-error code (missing token): restarting won't fix it.
await supervise(process.execPath, [worker, ...process.argv.slice(2)], { say, stopCodes: [0, 2] });
