// Builds the macOS LaunchAgent that starts the PrizePicks watcher at login and restarts it if it dies.
export const LABEL = 'com.guibot.ppwatch';

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * @param {{ node: string, root: string, stayAwake?: boolean }} options
 * stayAwake wraps the watcher in `caffeinate -i` so the Mac doesn't idle-sleep while it runs.
 */
export function launchAgentPlist({ node, root, stayAwake = false }) {
  const program = [...(stayAwake ? ['/usr/bin/caffeinate', '-i'] : []), node, `${root}/scripts/pp-watch.mjs`];
  const log = `${root}/scripts/.pp-watch.log`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${program.map((arg) => `    <string>${esc(arg)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key>
  <string>${esc(root)}</string>
  <key>RunAtLoad</key>
  <true/>
  <!-- Restart if it crashes. A clean exit (Ctrl+C, missing token) stays stopped. -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${esc(log)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(log)}</string>
</dict>
</plist>
`;
}
