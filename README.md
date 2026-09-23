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

The `dev` module posts PRs opened/merged, failed workflow runs, releases, and Jira issue changes.

1. Set `GITHUB_WEBHOOK_SECRET` and/or `JIRA_WEBHOOK_SECRET` to long random strings (`openssl rand -hex 32`).
2. GitHub: repo Settings → Webhooks → Add webhook. Payload URL `https://<your-railway-domain>/webhooks/github`,
   content type `application/json`, the same secret, and events: Pull requests, Workflow runs, Releases, Pushes.
3. Jira: Settings → System → WebHooks → Create. URL `https://<your-railway-domain>/webhooks/jira`, the same
   secret, events: Issue created and Issue updated.
4. In Discord: `/config dev add source:GitHub target:owner/repo channel:#dev`, and the same with `source:Jira target:SD`.

Pushes are stored but not posted. Senior Design stats use them later.

The old PrizePicks tracker lives in `legacy/prizepicks/` until it's ported as a module.
