# guiBot

My personal everything bot for Discord. It runs my servers and keeps track of how my Senior Design team is doing.

## Develop

```bash
cp .env.example .env   # fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID, OWNER_IDS
npm install
npm run db:migrate     # creates prisma/dev.db
npm run deploy         # registers slash commands in DEV_GUILD_ID
npm run dev
npm test
```

In the Discord Developer Portal, turn on the Server Members and Message Content intents.

## Add a command

Create one file in `src/modules/<module>/commands/`, then run `npm run deploy`:

```ts
import { SlashCommandBuilder } from 'discord.js';
import { command } from '../../../core/define.js';
import { info } from '../../../core/embeds.js';

export default command({
  data: new SlashCommandBuilder().setName('hello').setDescription('Say hi.'),
  async run({ interaction }) {
    await interaction.reply({ embeds: [info('hi')] });
  },
});
```

To add a module, create `src/modules/<name>/index.ts` that exports `moduleMeta({ name, description })`. Put event handlers in `events/` and scheduled job handlers in `jobs/`.

## Deploy (Railway)

- Deploy from this repo. Railway builds from `Dockerfile`.
- Add a volume mounted at `/data`.
- Set these env vars: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `OWNER_IDS`, `DATABASE_URL=file:/data/guibot.db`, `NODE_ENV=production`. Set `ENABLED_MODULES` too if you want to limit which modules load.
- On boot the container runs migrations, registers global commands, then starts the bot. The healthcheck is `GET /health`.
- If command registration fails on boot, the bot still starts; commands just stay whatever they were last registered as.

## GitHub and Jira notifications

The `dev` module posts PRs opened/merged, review requests, approvals and change requests, failed workflow runs (and "back to green" when the next run passes), releases, pushes to the default branch (so people know to pull), and Jira issue changes.

1. Set `GITHUB_WEBHOOK_SECRET` and/or `JIRA_WEBHOOK_SECRET` to long random strings (`openssl rand -hex 32`).
2. GitHub: repo Settings → Webhooks → Add webhook. Payload URL `https://<your-railway-domain>/webhooks/github`,
   content type `application/json`, the same secret, and events: Pull requests, Pull request reviews, Workflow runs, Releases, Pushes.
3. Jira: Settings → System → WebHooks → Create. URL `https://<your-railway-domain>/webhooks/jira`, the same
   secret, events: Issue created and Issue updated.
4. In Discord: `/config dev add source:GitHub target:owner/repo channel:#dev`, and the same with `source:Jira target:SD`.

To ping a role when a workflow fails: `/config dev failure-ping role:@Devs` (run it with no role to turn it off).

Pushes to other branches are stored but not posted. Senior Design stats use them.

## Senior Design

The `sd` module runs the team: who's who, standups, meetings, deadlines, the Jira sprint, and progress stats.
Stats come from the GitHub and Jira events above, so set those feeds up first.

- `/team link github:<login> jira:<email or Jira profile link>`: everyone runs this once so their work counts.
  Managers can link others with `member:`. `/team list`, `/team unlink`.
- `/deadline add title date [time]`, `/deadline list`, `/deadline done id`. Reminders go out 7, 2, and 1 day
  before, and a board in the deadlines channel keeps itself current.
- `/meeting create title date time [length] [weekly] [location] [channel]`: posts RSVP buttons, creates a
  Discord event (needs Manage Events), and pings everyone going or maybe 1 hour and 10 minutes before.
  Weekly meetings post next week's copy when they start. `/meeting list`, `/meeting cancel id`.
- `/sprint [project]`: the active sprint's to do, in progress, and done, with who owns what.
- `/progress [member] [days]`: commits, PRs, reviews, Jira issues done, and standup attendance.
- `/standup config channel time [days] [summary-after]`: posts a standup with a button that opens a form (done,
  today, blockers). The summary posts later and flags who's missing and who's blocked. `/standup off` stops it,
  `/standup open|close` runs today's by hand.

Settings live in `/config sd`:

- `digest channel [day] [time]`: a weekly post of who did what and what's due. `digest-off` stops it.
- `deadlines channel`: where deadline reminders and the board go.
- `timezone zone`: for schedules and the dates people type. Defaults to America/New_York.
- `show`: current settings.

`/sprint` and Jira email lookup in `/team link` need read-only API access: set `JIRA_BASE_URL`
(`https://<site>.atlassian.net`), `JIRA_EMAIL`, and `JIRA_API_TOKEN` (from id.atlassian.com, API tokens).
Without them, people can paste their Jira profile link into `/team link` instead of an email.

The old PrizePicks tracker lives in `legacy/prizepicks/` until it's ported as a module.
