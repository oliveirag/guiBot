const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

/**
 * Instead of parsing the DOM (which gets blocked by Kasada bot detection),
 * we intercept the internal API responses the PrizePicks app makes.
 * This gives us clean JSON data directly.
 *
 * @param {string} url - The public open-lineups URL for the user
 * @returns {Promise<Entry[]>}
 */
async function scrapeEntries(url) {
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: false, // Run visible -- much harder to detect than headless
      defaultViewport: null,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,800",
      ],
      executablePath: puppeteer.executablePath(),
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );

    // Capture all API responses that look like entries/lineups
    const capturedEntries = [];

    page.on("response", async (response) => {
      const responseUrl = response.url();

      // Intercept any API call that looks like it contains entries or lineups
      if (
        responseUrl.includes("prizepicks.com") &&
        (responseUrl.includes("entries") ||
          responseUrl.includes("lineups") ||
          responseUrl.includes("slips") ||
          responseUrl.includes("picks"))
      ) {
        try {
          const json = await response.json();
          console.log(`[scraper] Captured API response from: ${responseUrl}`);

          if (process.env.DEBUG_HTML === "true") {
            const fs = require("fs");
            const safeName = responseUrl.replace(/[^a-z0-9]/gi, "_").slice(-60);
            fs.writeFileSync(
              `debug_api_${safeName}.json`,
              JSON.stringify(json, null, 2)
            );
            console.log(`[scraper] Saved API response to debug_api_${safeName}.json`);
          }

          // Normalize the response into our entry format
          const entries = normalizeApiResponse(json, responseUrl);
          capturedEntries.push(...entries);
        } catch (e) {
          // Not JSON, skip
        }
      }
    });

    // Also log ALL prizepicks API calls in debug mode so we can find the right endpoint
    if (process.env.DEBUG_HTML === "true") {
      page.on("response", async (response) => {
        const responseUrl = response.url();
        if (responseUrl.includes("api.prizepicks.com") || responseUrl.includes("api-staging.prizepicks")) {
          console.log(`[scraper] PrizePicks API call: ${responseUrl}`);
        }
      });
    }

    console.log(`[scraper] Navigating to ${url}`);
    await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

    // Wait for page to fully settle and all API calls to complete
    await new Promise((r) => setTimeout(r, 5000));

    console.log(`[scraper] Captured ${capturedEntries.length} entries from API interception`);

    // Fallback: if we caught nothing from interception, try DOM as last resort
    if (capturedEntries.length === 0) {
      console.log("[scraper] No API responses captured, trying DOM fallback...");
      const html = await page.content();

      if (process.env.DEBUG_HTML === "true") {
        require("fs").writeFileSync("debug_page.html", html);
        console.log("[scraper] Dumped page HTML to debug_page.html");
      }

      const domEntries = await page.evaluate(() => {
        const results = [];
        const cards = Array.from(
          document.querySelectorAll('[class*="card"], [class*="tile"], [class*="entry"], [class*="slip"], [class*="lineup"]')
        ).filter((el) => {
          const text = el.innerText || "";
          return text.includes("More") || text.includes("Less") ||
                 text.includes("MORE") || text.includes("LESS");
        });

        for (const card of cards) {
          const text = card.innerText || "";
          const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
          results.push({
            id: card.getAttribute("data-id") || card.id || null,
            rawText: text,
            rawLines: lines,
            players: [],
            type: null,
            amount: null,
            payout: null,
            scrapedAt: new Date().toISOString(),
            source: "dom",
          });
        }
        return results;
      });

      return domEntries;
    }

    return capturedEntries;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Normalize a raw PrizePicks API JSON response into our entry format.
 * The exact shape depends on which endpoint was hit -- we handle multiple.
 *
 * @param {object} json - Raw API response
 * @param {string} url - The endpoint URL (used to determine shape)
 * @returns {Entry[]}
 */
function normalizeApiResponse(json, url) {
  const entries = [];
  const now = new Date().toISOString();

  // Handle array responses
  const items = Array.isArray(json)
    ? json
    : json.data
    ? Array.isArray(json.data) ? json.data : [json.data]
    : [];

  for (const item of items) {
    // Extract picks/legs from the entry
    const legs = item.legs || item.picks || item.slip_entries || item.relationships?.slip_entries?.data || [];
    const players = legs.map((leg) => {
      const player = leg.player || leg.attributes?.player || {};
      const stat = leg.stat_type || leg.attributes?.stat_type || "";
      const line = leg.line_score || leg.attributes?.line_score || "";
      const direction = leg.over_under || leg.attributes?.over_under || "";
      const name = player.name || player.attributes?.name || leg.player_name || "";
      return `${name} | ${stat} ${line} | ${direction.toUpperCase()}`;
    });

    entries.push({
      id: item.id || item.entry_id || null,
      rawText: JSON.stringify(item),
      rawLines: players,
      players,
      type: item.entry_type || item.attributes?.entry_type || null,
      amount: item.entry_fee != null ? `$${item.entry_fee}` :
              item.attributes?.entry_fee != null ? `$${item.attributes.entry_fee}` : null,
      payout: item.payout != null ? `$${item.payout}` :
              item.attributes?.payout != null ? `$${item.attributes.payout}` : null,
      scrapedAt: now,
      source: "api",
    });
  }

  return entries;
}

module.exports = { scrapeEntries };
