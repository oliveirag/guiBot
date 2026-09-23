require("dotenv").config();
const { Client, GatewayIntentBits, ActivityType } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { scrapeEntries } = require("./scraper");
const { buildEntryEmbed } = require("./formatter");
const USERS = require("./users");

// ─── Config ────────────────────────────────────────────────────────────────

const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;
const CHANNEL_ID       = process.env.CHANNEL_ID;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);
const SEEN_FILE        = path.join(__dirname, "seen_entries.json");

if (!DISCORD_TOKEN || !CHANNEL_ID) {
  console.error(
    "[bot] ERROR: Missing DISCORD_TOKEN or CHANNEL_ID in .env file.\n" +
    "Copy .env.example to .env and fill in your values."
  );
  process.exit(1);
}

if (!USERS || USERS.length === 0) {
  console.error("[bot] ERROR: No users defined in users.js.");
  process.exit(1);
}

console.log(`[bot] Tracking ${USERS.length} user(s): ${USERS.map((u) => u.name).join(", ")}`);

// ─── State ─────────────────────────────────────────────────────────────────

function loadSeenIds() {
  try {
    if (fs.existsSync(SEEN_FILE)) {
      const raw = fs.readFileSync(SEEN_FILE, "utf8");
      return new Set(JSON.parse(raw));
    }
  } catch (e) {
    console.warn("[bot] Could not load seen_entries.json, starting fresh.");
  }
  return new Set();
}

function saveSeenIds(seenIds) {
  fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenIds]), "utf8");
}

/**
 * Fingerprint includes the username so entries from different users
 * never collide even if they happen to place identical slips.
 */
function fingerprintEntry(entry, username) {
  const base = entry.id
    ? entry.id
    : entry.rawLines
        .filter((l) => l.length > 2)
        .slice(0, 12)
        .join("|")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

  return `${username}::${base}`;
}

// ─── Discord client ─────────────────────────────────────────────────────────

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once("ready", () => {
  console.log(`[bot] Logged in as ${client.user.tag}`);
  client.user.setActivity("PrizePicks", { type: ActivityType.Watching });
  startPolling();
});

// ─── Polling ────────────────────────────────────────────────────────────────

let seenIds = loadSeenIds();
let isPolling = false;

async function pollUser(user, channel) {
  console.log(`[bot] Polling user: ${user.name}`);

  const entries = await scrapeEntries(user.url);

  if (entries.length === 0) {
    console.log(`[bot] No entries found for ${user.name}.`);
    return 0;
  }

  let newCount = 0;

  for (const entry of entries) {
    const fp = fingerprintEntry(entry, user.name);

    if (!seenIds.has(fp)) {
      console.log(`[bot] New entry for ${user.name}: ${fp.slice(0, 60)}...`);
      seenIds.add(fp);

      const embed = buildEntryEmbed(entry, user.name, user.url);
      await channel.send({ embeds: [embed] });
      newCount++;

      // Small delay between messages to avoid Discord rate limits
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return newCount;
}

async function poll() {
  if (isPolling) {
    console.log("[bot] Previous poll still running, skipping...");
    return;
  }

  isPolling = true;

  try {
    console.log(`[bot] Poll started at ${new Date().toLocaleTimeString()}`);

    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || !channel.isTextBased()) {
      console.error("[bot] Channel not found or not text-based.");
      return;
    }

    let totalNew = 0;

    // Poll users sequentially to avoid hammering PrizePicks servers.
    // Swap to Promise.all if you want parallel and have few users.
    for (const user of USERS) {
      try {
        const newCount = await pollUser(user, channel);
        totalNew += newCount;
      } catch (err) {
        console.error(`[bot] Error polling ${user.name}:`, err.message);
      }
    }

    if (totalNew > 0) {
      saveSeenIds(seenIds);
      console.log(`[bot] Sent ${totalNew} new alert(s) across all users.`);
    } else {
      console.log("[bot] No new entries for any user.");
    }
  } catch (err) {
    console.error("[bot] Poll error:", err.message);
  } finally {
    isPolling = false;
  }
}

function startPolling() {
  console.log(`[bot] Starting poll loop every ${POLL_INTERVAL_MS / 1000}s`);
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

// ─── Start ──────────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN);