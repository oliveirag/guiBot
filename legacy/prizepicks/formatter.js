const { EmbedBuilder } = require("discord.js");

const PRIZEPICKS_PURPLE = 0x6c2bd9;

/**
 * Parses raw entry text into structured pick data.
 *
 * @param {string[]} lines - Raw text lines from the entry card
 * @returns {Pick[]}
 */
function parsePicksFromLines(lines) {
  const picks = [];
  const directionWords = ["more", "less", "over", "under"];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hasDirection = directionWords.some((w) =>
      line.toLowerCase().includes(w)
    );

    if (hasDirection) {
      const playerLine = lines[i - 1] || lines[i - 2] || "";
      const statLine = lines[i + 1] || "";
      const numMatch = line.match(/(\d+\.?\d*)/);
      const statValue = numMatch ? numMatch[1] : null;

      const direction =
        line.toLowerCase().includes("more") || line.toLowerCase().includes("over")
          ? "MORE 🔼"
          : "LESS 🔽";

      picks.push({
        player: playerLine,
        direction,
        stat: statLine || null,
        value: statValue,
      });
    }
  }

  return picks;
}

/**
 * Builds a Discord embed for a new PrizePicks entry.
 *
 * @param {object} entry - The scraped entry object
 * @param {string} username - Display name of the tracked user
 * @param {string} profileUrl - The user's public lineup URL
 * @returns {EmbedBuilder}
 */
function buildEntryEmbed(entry, username = "Tracked User", profileUrl = "") {
  const picks = parsePicksFromLines(entry.rawLines);

  const embed = new EmbedBuilder()
    .setColor(PRIZEPICKS_PURPLE)
    .setTitle(`🎰 New Entry — ${username}`)
    .setURL(profileUrl)
    .setTimestamp(new Date(entry.scrapedAt))
    .setFooter({
      text: "PrizePicks Tracker",
      iconURL:
        "https://pbs.twimg.com/profile_images/1657079619968753664/f8TSKoWP_400x400.jpg",
    });

  if (entry.type) {
    embed.addFields({ name: "🎮 Play Type", value: entry.type, inline: true });
  }

  if (entry.amount) {
    embed.addFields({ name: "💵 Entry", value: entry.amount, inline: true });
  }

  if (entry.payout) {
    embed.addFields({ name: "💰 Potential Payout", value: entry.payout, inline: true });
  }

  if (picks.length > 0) {
    const pickLines = picks
      .map((p) => {
        const val = p.value ? ` (${p.value})` : "";
        const stat = p.stat ? ` — ${p.stat}` : "";
        return `**${p.player}**${stat}${val}\n${p.direction}`;
      })
      .join("\n\n");

    embed.addFields({
      name: `📋 Picks (${picks.length})`,
      value: pickLines.slice(0, 1024),
    });
  } else {
    const rawPreview = entry.rawLines.slice(0, 20).join("\n");
    embed.addFields({
      name: "📋 Entry Details (raw)",
      value: ("```\n" + rawPreview + "\n```").slice(0, 1024),
    });
    embed.addFields({
      name: "⚠️ Note",
      value: "Selectors may need tuning. Run with `DEBUG_HTML=true` and inspect the dumped HTML file.",
    });
  }

  return embed;
}

module.exports = { buildEntryEmbed, parsePicksFromLines };